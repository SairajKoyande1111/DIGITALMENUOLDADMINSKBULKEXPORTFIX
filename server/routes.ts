import { setupVite, serveStatic, log } from "./vite";
import type { Express } from "express";
import { createServer, type Server } from "http";
// Removed storage and cart schema imports - Admin-only system
import { connectToDatabase } from "./db/mongodb";
import { Restaurant } from "./models/Restaurant";
import { MenuItem } from "./models/MenuItem";
import { Admin } from "./models/Admin";
import { Image } from "./models/Image";
import { authenticateAdmin, generateToken, AuthRequest } from "./middleware/auth";
import bcrypt from "bcryptjs";
import { validateAdminCredentials } from "./fallback-auth";
import { getMockRestaurants, addMockRestaurant, getMockMenuItems, addMockMenuItem, deleteMockRestaurant } from "./mock-data";
import { connectToRestaurantDatabase, getMenuItemModel, fetchMenuItemsFromCustomDB, createMenuItemInCustomDB, updateMenuItemInCustomDB, deleteMenuItemFromCustomDB, extractCategoriesFromCustomDB } from "./db/dynamic-mongodb";
import { generateQRCode } from "./utils/qrcode";
import adminSettingsRoutes from "./routes/admin-settings";
import multer from 'multer';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';

// Load environment variables explicitly for Cloudinary if they are missing
if (!process.env.CLOUDINARY_CLOUD_NAME) {
  dotenv.config();
}

import nodemailer from 'nodemailer';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dnfee6rib',
  api_key: process.env.CLOUDINARY_API_KEY || '193651557981285',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'sRCb0UvRvqeF0cPLS9eSJj52Nms',
});

async function sendOTPEmail(email: string, otp: string) {
  try {
    if (!transporter) {
      transporter = createTransporter();
    }
    
    const emailUser = process.env.EMAIL_USER?.trim();
    if (!emailUser) {
      throw new Error('EMAIL_USER environment variable is not set');
    }
    
    const mailOptions = {
      from: emailUser,
      to: email,
      subject: 'Your Login OTP',
      text: `Your One-Time Password for login is: ${otp}. It will expire in 10 minutes.`,
      html: `<p>Your One-Time Password for login is: <strong>${otp}</strong>.</p><p>It will expire in 10 minutes.</p>`,
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent successfully to: ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send OTP email: ${error instanceof Error ? error.message : error}`);
    throw error;
  }
}

// Configure Cloudinary storage for multer
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'menu-items',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  } as any,
});

const cloudinaryUpload = multer({ storage: cloudinaryStorage });

export async function registerRoutes(app: Express): Promise<Server> {
  // Connect to MongoDB
  log("🔌 Attempting to connect to MongoDB...");
  await connectToDatabase();
  log("✅ Connected to MongoDB successfully");

  // Endpoint for Cloudinary image upload
  app.post("/api/admin/upload-image", authenticateAdmin, (req: any, res, next) => {
    console.log("📸 Incoming upload request to /api/admin/upload-image");
    console.log("🔑 Auth Admin:", req.admin?.username);
    cloudinaryUpload.single('image')(req, res, (err) => {
      if (err) {
        console.error("❌ Multer/Cloudinary middleware error:", err);
        console.log("☁️ Cloudinary Config Check:", {
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? "Present" : "Missing",
          api_key: process.env.CLOUDINARY_API_KEY ? "Present" : "Missing",
          api_secret: process.env.CLOUDINARY_API_SECRET ? "Present" : "Missing"
        });
        return res.status(500).json({ 
          message: "Middleware upload failed", 
          error: err.message,
          stack: err.stack,
          code: (err as any).code,
          http_code: (err as any).http_code
        });
      }
      next();
    });
  }, async (req: any, res) => {
    try {
      console.log("📁 File processed by middleware:", req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      } : "No file");
      
      if (!req.file) {
        console.error("❌ No file found in request after middleware");
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      console.log("✅ Image upload successful:", req.file.path);
      res.json({ 
        url: req.file.path,
        success: true 
      });
    } catch (error: any) {
      console.error("❌ Controller upload error:", error);
      res.status(500).json({ 
        message: "Failed to process uploaded image",
        error: error.message 
      });
    }
  });

  // Configure multer for file uploads - no size limit
  const upload = multer({ 
    dest: 'uploads/',
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB per file
      fieldSize: 500 * 1024 * 1024  // 500MB for form fields
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ];
      
      // Allow both Excel files and images (including raw formats)
      const isExcelFile = allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls');
      const isImageFile = file.mimetype.startsWith('image/');
      const rawFormats = ['.arw', '.cr2', '.nef', '.raf', '.rw2', '.dng', '.raw'];
      const isRawFormat = rawFormats.some(ext => file.originalname.toLowerCase().endsWith(ext));
      
      if (isExcelFile || isImageFile || isRawFormat) {
        cb(null, true);
      } else {
        cb(new Error('Only Excel files and images are allowed'));
      }
    }
  });

  // Debug endpoint to check potrice collection directly
  app.get("/api/admin/debug/potrice-check", async (req, res) => {
    try {
      console.log('🔍 Debug: Checking potrice collection directly');
      
      // Get restaurant
      const restaurant = await Restaurant.findById('689865a9c611434f0ce35b55');
      if (!restaurant?.mongoUri) {
        return res.json({ error: 'No restaurant or mongoUri found' });
      }
      
      console.log('🔗 Debug: MongoDB URI exists');
      
      // Connect to custom database
      const connection = await connectToRestaurantDatabase(restaurant.mongoUri);
      console.log('✅ Debug: Connected to custom database');
      
      // Check if potrice collection exists
      const collections = await connection.db.listCollections().toArray();
      const potriceExists = collections.some(c => c.name === 'potrice');
      console.log('📋 Debug: Collections found:', collections.map(c => c.name));
      console.log('🔍 Debug: Potrice collection exists:', potriceExists);
      
      if (!potriceExists) {
        return res.json({ 
          error: 'Potrice collection not found',
          collections: collections.map(c => c.name)
        });
      }
      
      // Count documents in potrice collection
      const count = await connection.db.collection('potrice').countDocuments();
      console.log('📊 Debug: Potrice collection document count:', count);
      
      // Get sample documents
      const samples = await connection.db.collection('potrice').find({}).limit(3).toArray();
      console.log('📄 Debug: Sample potrice documents:', samples.map(doc => ({ 
        _id: doc._id, 
        name: doc.name,
        category: doc.category
      })));
      
      return res.json({
        success: true,
        collectionExists: potriceExists,
        documentCount: count,
        sampleDocuments: samples.map(doc => ({ 
          _id: doc._id, 
          name: doc.name,
          category: doc.category,
          price: doc.price,
          allFields: Object.keys(doc)
        }))
      });
      
    } catch (error) {
      console.error('❌ Debug error:', error);
      return res.json({ error: error.message });
    }
  });

  // User Management for Master Admin
  app.post("/api/admin/users", authenticateAdmin, async (req: any, res: any) => {
    try {
      const admin = (req as any).admin;
      const isAdminUsername = admin.username?.toLowerCase() === 'admin';
      const isMasterRole = admin.role === 'master';
      const isMaster = isMasterRole || isAdminUsername;

      if (!isMaster) {
        return res.status(403).json({ message: "Only Master Admin can create users" });
      }

      const { username, password, email, assignedRestaurant } = req.body;
      
      if (!username || !password || !email || !assignedRestaurant) {
        return res.status(400).json({ message: "All fields are required including restaurant assignment" });
      }

      const existingAdmin = await Admin.findOne({ $or: [{ username }, { email }] });
      if (existingAdmin) {
        return res.status(400).json({ message: "Username or email already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newAdmin = new Admin({
        username,
        password: hashedPassword,
        email,
        role: 'admin',
        assignedRestaurant
      });

      await newAdmin.save();
      res.status(201).json({ message: "Admin user created successfully", user: { id: newAdmin._id, username: newAdmin.username } });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.get("/api/admin/users", authenticateAdmin, async (req: any, res: any) => {
    try {
      const admin = (req as any).admin;
      const isAdminUsername = admin.username?.toLowerCase() === 'admin';
      const isMasterRole = admin.role === 'master';
      const isMaster = isMasterRole || isAdminUsername;

      if (!isMaster) {
        return res.status(403).json({ message: "Access denied" });
      }
      const users = await Admin.find({ role: 'admin' }).populate('assignedRestaurant');
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Update Admin User
  app.patch("/api/admin/users/:id", authenticateAdmin, async (req: any, res: any) => {
    try {
      const admin = (req as any).admin;
      const isAdminUsername = admin.username?.toLowerCase() === 'admin';
      const isMasterRole = admin.role === 'master';
      const isMaster = isMasterRole || isAdminUsername;

      if (!isMaster) {
        return res.status(403).json({ message: "Only Master Admin can update users" });
      }

      const { id } = req.params;
      const { username, email, password, assignedRestaurant } = req.body;

      if (!id) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const updateData: any = {};
      if (username !== undefined) {
        updateData.username = username;
      }
      if (email !== undefined) {
        updateData.email = email;
      }
      if (password !== undefined && password) {
        // Hash the password if provided
        updateData.password = await bcrypt.hash(password, 10);
      }
      if (assignedRestaurant !== undefined) {
        updateData.assignedRestaurant = assignedRestaurant || null;
      }

      const updatedUser = await Admin.findByIdAndUpdate(id, updateData, { new: true }).populate('assignedRestaurant');
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "User updated successfully", user: updatedUser });
    } catch (error: any) {
      console.error("Update user error:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Delete Admin User
  app.delete("/api/admin/users/:id", authenticateAdmin, async (req: any, res: any) => {
    try {
      const admin = (req as any).admin;
      const isAdminUsername = admin.username?.toLowerCase() === 'admin';
      const isMasterRole = admin.role === 'master';
      const isMaster = isMasterRole || isAdminUsername;

      if (!isMaster) {
        return res.status(403).json({ message: "Only Master Admin can delete users" });
      }

      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const deletedUser = await Admin.findByIdAndDelete(id);
      
      if (!deletedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "User deleted successfully" });
    } catch (error: any) {
      console.error("Delete user error:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Admin Authentication Routes
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { username, password, role } = req.body;
      console.log(`🔑 Login attempt: ${username} as ${role}`);
      
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Enforce Master Admin logic:
      // If the username is 'admin', it MUST be a master admin login attempt.
      if (username === "admin" && role !== "master") {
        return res.status(403).json({ message: "Invalid credentials" });
      }
      
      // If logging in as master, the username MUST be 'admin'
      if (role === "master" && username !== "admin") {
        return res.status(403).json({ message: "Invalid credentials" });
      }

      // Try MongoDB first with quick timeout, then fallback
      let admin = null;
      
      try {
        admin = await Promise.race([
          Admin.findOne({ username }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("MongoDB timeout")), 5000)
          )
        ]) as any;
        
        if (admin) {
          console.log(`✅ Admin found in DB: ${admin.username} (${admin.role})`);
          const isValidPassword = await bcrypt.compare(password, admin.password);
          if (isValidPassword) {
            // Check if OTP should be required
            let otpRequired = false;
            
            // For master admin, check otpMasterAdminEnabled flag
            if (admin.role === 'master' || username === 'admin') {
              otpRequired = admin.otpMasterAdminEnabled === true;
            } else {
              // For regular admins, check restaurant OTP setting
              const restaurant = await Restaurant.findById(admin.assignedRestaurant);
              otpRequired = restaurant ? restaurant.otpEnabled !== false : true;
            }

            // Check if email is available for OTP
            if (!admin.email || !otpRequired) {
              console.warn(`⚠️ Admin ${username} skipping OTP (Email: ${!!admin.email}, OTP Required: ${otpRequired})`);
              const token = generateToken(admin._id.toString());
              return res.json({ 
                token, 
                admin: { 
                  id: admin._id, 
                  username: admin.username, 
                  email: admin.email, 
                  role: admin.role 
                } 
              });
            }

            // Generate OTP
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            admin.otp = otp;
            admin.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
            await admin.save();

            // Send Email
            try {
              console.log(`📧 Sending OTP to: ${admin.email}`);
              await sendOTPEmail(admin.email, otp);
              return res.json({ 
                requiresOtp: true,
                message: "OTP sent to your registered email"
              });
            } catch (emailError: any) {
              console.error("Failed to send OTP email:", emailError);
              const errorMessage = emailError.code === 'EAUTH' 
                ? "Email authentication failed. Please check your App Password settings."
                : "Failed to send OTP email. Please try again later.";
              return res.status(500).json({ message: errorMessage });
            }
          }
        } else {
          console.log(`⚠️ Admin not found in DB: ${username}`);
        }
      } catch (mongoError) {
        // MongoDB connection failed or timeout, use fallback quickly
        console.log("MongoDB not available, using fallback authentication");
      }

      // Try fallback authentication
      const fallbackAdmin = await validateAdminCredentials(username, password);
      if (fallbackAdmin) {
        console.log(`✅ Fallback admin authenticated: ${username}`);
        
        // Ensure master admin exists in DB for settings and OTP storage
        let dbAdmin = await Admin.findOne({ username: 'admin' }) as any;
        if (!dbAdmin) {
          console.log("Creating master admin in DB for OTP storage");
          dbAdmin = new Admin({
            username: 'admin',
            password: await bcrypt.hash(password, 10),
            email: (fallbackAdmin as any).email || 'raneaniket23@gmail.com',
            role: 'master'
          });
          await dbAdmin.save();
        }
        
        // Check if OTP is enabled for master admin
        if (!dbAdmin.otpMasterAdminEnabled) {
          console.warn(`⚠️ Master admin OTP is disabled`);
          const token = generateToken(dbAdmin._id.toString());
          return res.json({ 
            token, 
            admin: { 
              id: dbAdmin._id, 
              username: dbAdmin.username, 
              email: dbAdmin.email, 
              role: dbAdmin.role 
            } 
          });
        }
        
        // Handle OTP for master admin (fallback or DB)
        const masterEmail = dbAdmin.email || (fallbackAdmin as any).email || 'raneaniket23@gmail.com';
        
        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        dbAdmin.otp = otp;
        dbAdmin.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
        await dbAdmin.save();

        // Send Email
        try {
          console.log(`📧 Sending OTP to master: ${masterEmail}`);
          await sendOTPEmail(masterEmail, otp);
          return res.json({ 
            requiresOtp: true,
            message: "OTP sent to your registered master email"
          });
        } catch (emailError: any) {
          console.error("Failed to send OTP email to master:", emailError);
          const errorMessage = emailError.code === 'EAUTH' 
            ? "Email authentication failed. Please check your App Password settings."
            : "Failed to send OTP email. Please try again later.";
          return res.status(500).json({ message: errorMessage });
        }
      }

      console.log(`❌ Invalid credentials for ${username}`);
      return res.status(401).json({ message: "Invalid credentials" });
    } catch (error) {
      console.error("🚨 Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // OTP Verification Route
  app.post("/api/admin/verify-otp", async (req, res) => {
    try {
      const { username, otp } = req.body;
      if (!username || !otp) {
        return res.status(400).json({ message: "Username and OTP are required" });
      }

      const admin = await Admin.findOne({ username }) as any;
      if (!admin || !admin.otp || !admin.otpExpires) {
        return res.status(400).json({ message: "Invalid verification request" });
      }

      if (admin.otp !== otp || admin.otpExpires < new Date()) {
        return res.status(401).json({ message: "Invalid or expired OTP" });
      }

      // Clear OTP after successful verification
      admin.otp = undefined;
      admin.otpExpires = undefined;
      await admin.save();

      const token = generateToken(admin._id.toString());
      res.json({
        token,
        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          role: admin.role
        }
      });
    } catch (error) {
      console.error("OTP verification error:", error);
      res.status(500).json({ message: "Verification failed" });
    }
  });

  app.post("/api/admin/register", async (req, res) => {
    try {
      const { username, password, email } = req.body;
      
      if (!username || !password || !email) {
        return res.status(400).json({ message: "Username, password, and email are required" });
      }

      const existingAdmin = await Admin.findOne({ $or: [{ username }, { email }] });
      if (existingAdmin) {
        return res.status(400).json({ message: "Username or email already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const admin = new Admin({
        username,
        password: hashedPassword,
        email
      });

      await admin.save();
      const token = generateToken(admin._id.toString());
      
      res.status(201).json({ 
        token, 
        admin: { 
          id: admin._id, 
          username: admin.username, 
          email: admin.email, 
          role: admin.role 
        } 
      });
    } catch (error) {
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Restaurant Management Routes
  app.get("/api/admin/restaurants", authenticateAdmin, async (req, res) => {
    try {
      const admin = (req as any).admin;
      const isAdminUsername = admin.username?.toLowerCase() === 'admin';
      const isMasterRole = admin.role === 'master';
      const isMaster = isMasterRole || isAdminUsername;

      console.log(`📊 Fetching restaurants - isMaster: ${isMaster}, username: ${admin.username}, role: ${admin.role}`);

      // Try MongoDB first with quick timeout, then fallback
      try {
        let restaurants;
        if (isMaster) {
          console.log("✅ Master admin - fetching ALL restaurants");
          restaurants = await Promise.race([
            Restaurant.find().sort({ createdAt: -1 }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("MongoDB timeout")), 5000)
            )
          ]);
        } else {
          console.log(`🏢 Regular admin - fetching assigned restaurant: ${admin.assignedRestaurant}`);
          restaurants = await Promise.race([
            Restaurant.find({ _id: admin.assignedRestaurant }).sort({ createdAt: -1 }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("MongoDB timeout")), 5000)
            )
          ]);
        }
        
        console.log(`📦 Returning ${restaurants?.length || 0} restaurants`);
        res.json(restaurants);
      } catch (mongoError) {
        // MongoDB not available or timeout, return mock data quickly
        console.log("MongoDB not available for restaurants, returning mock data");
        const mockRest = getMockRestaurants();
        console.log(`📦 Mock data: returning ${mockRest?.length || 0} restaurants`);
        res.json(mockRest);
      }
    } catch (error) {
      console.error("❌ Error fetching restaurants:", error);
      res.status(500).json({ message: "Failed to fetch restaurants" });
    }
  });

  // Get single restaurant by ID
  app.get("/api/admin/restaurants/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`🔍 Fetching restaurant with ID: ${id}`);
      
      // Try MongoDB first with quick timeout, then fallback
      try {
        const restaurantPromise = Restaurant.findById(id);
        const restaurant = await Promise.race([
          restaurantPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("MongoDB timeout")), 5000)
          )
        ]);
        
        if (restaurant) {
          console.log(`✅ Restaurant found: ${restaurant.name}`);
          console.log(`📂 Restaurant customTypes: [${(restaurant.customTypes || []).join(', ')}]`);
          return res.json(restaurant);
        } else {
          console.log(`❌ Restaurant not found in MongoDB: ${id}`);
        }
      } catch (mongoError) {
        console.log("MongoDB not available for restaurant fetch, checking mock data");
      }
      
      // Try mock data as fallback
      const mockRestaurants = getMockRestaurants();
      const mockRestaurant = mockRestaurants.find(r => r._id === id);
      
      if (mockRestaurant) {
        console.log(`✅ Restaurant found in mock data: ${mockRestaurant.name}`);
        return res.json(mockRestaurant);
      }
      
      console.log(`❌ Restaurant not found anywhere: ${id}`);
      return res.status(404).json({ message: "Restaurant not found" });
    } catch (error) {
      console.error("Error fetching restaurant:", error);
      res.status(500).json({ message: "Failed to fetch restaurant" });
    }
  });

  app.post("/api/admin/restaurants", authenticateAdmin, async (req, res) => {
    try {
      const { name, description, address, phone, email, image, website, mongoUri, customTypes, isActive, otpEnabled } = req.body;
      
      if (!name || !description || !address || !phone || !email || !image) {
        return res.status(400).json({ message: "All fields are required" });
      }

      try {
        let finalCustomTypes = customTypes || ['Starters', 'Main Course', 'Desserts', 'Beverages'];
        
        // If mongoUri is provided, try to extract categories with timeout
        if (mongoUri) {
          try {
            console.log(`Extracting categories from custom database for restaurant: ${name}`);
            
            const categoryPromise = (async () => {
              const customConnection = await connectToRestaurantDatabase(mongoUri);
              return await extractCategoriesFromCustomDB(customConnection);
            })();
            
            const extractedCategories = await Promise.race([
              categoryPromise,
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Category extraction timeout")), 3000)
              )
            ]);
            
            if (extractedCategories && extractedCategories.length > 0) {
              finalCustomTypes = extractedCategories;
              console.log(`✅ Using extracted categories: ${finalCustomTypes.join(', ')}`);
            } else {
              console.log('⚠️ No categories found in custom database, using default categories');
            }
          } catch (customDbError) {
            console.log('Failed to extract categories from custom database, using provided/default categories');
          }
        }

        // Generate QR code if website is provided
        let qrCode = null;
        if (website) {
          try {
            qrCode = await generateQRCode(website);
            console.log(`✅ QR code generated for website: ${website}`);
          } catch (qrError) {
            console.log(`⚠️ Failed to generate QR code for website: ${website}`, qrError);
          }
        }

        // Try to save to MongoDB with timeout
        const savePromise = (async () => {
          const restaurant = new Restaurant({
            name,
            description,
            address,
            phone,
            email,
            image,
            website,
            qrCode,
            mongoUri,
            customTypes: finalCustomTypes,
            isActive: isActive ?? true,
            otpEnabled: otpEnabled ?? true
          });
          
          await restaurant.save();
          return restaurant;
        })();
        
        const restaurant = await Promise.race([
          savePromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("MongoDB save timeout")), 2000)
          )
        ]);
        
        res.status(201).json(restaurant);
      } catch (mongoError) {
        // MongoDB not available, add to mock data store
        console.log("MongoDB not available for restaurant creation, using mock data store");
        const mockRestaurant = addMockRestaurant({ 
          name, 
          description, 
          address, 
          phone, 
          email, 
          image,
          website,
          qrCode,
          mongoUri,
          customTypes: customTypes || ['Starters', 'Main Course', 'Desserts', 'Beverages'],
          isActive: isActive ?? true,
          otpEnabled: otpEnabled ?? true
        });
        res.status(201).json(mockRestaurant);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to create restaurant" });
    }
  });

  app.put("/api/admin/restaurants/:id", authenticateAdmin, async (req, res) => {
    try {
      const admin = (req as any).admin;
      const isAdminUsername = admin.username?.toLowerCase() === 'admin';
      const isMasterRole = admin.role === 'master';
      const isMaster = isMasterRole || isAdminUsername;

      if (!isMaster) {
        return res.status(403).json({ message: "Only Master Admin can edit restaurants" });
      }
      const { id } = req.params;
      const { name, description, address, phone, email, image, website, mongoUri, customTypes, isActive, otpEnabled } = req.body;

      console.log(`🔄 Updating restaurant ${id} with data:`, {
        name, description, address, phone, email, 
        hasImage: !!image, website, mongoUri, customTypes, isActive, otpEnabled
      });

      // Handle customTypes properly - it can be an array or a string
      let finalCustomTypes;
      if (Array.isArray(customTypes)) {
        finalCustomTypes = customTypes;
      } else if (typeof customTypes === 'string') {
        finalCustomTypes = customTypes.split(',').map((t: string) => t.trim());
      } else {
        finalCustomTypes = ['Starters', 'Main Course', 'Desserts', 'Beverages'];
      }

      console.log(`📝 Final customTypes: [${finalCustomTypes.join(', ')}]`);
      
      if (mongoUri) {
        try {
          console.log(`🔍 Extracting categories from custom database for restaurant update: ${name}`);
          
          const categoryPromise = (async () => {
            try {
              const customConnection = await connectToRestaurantDatabase(mongoUri);
              return await extractCategoriesFromCustomDB(customConnection);
            } catch (connError) {
              console.log('❌ Failed to connect to custom database:', connError.message);
              throw connError;
            }
          })();
          
          const extractedCategories = await Promise.race([
            categoryPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Category extraction timeout")), 3000)
            )
          ]);
          
          if (extractedCategories && extractedCategories.length > 0) {
            finalCustomTypes = extractedCategories;
            console.log(`✅ Using extracted categories: ${finalCustomTypes.join(', ')}`);
          } else {
            console.log('⚠️ No categories found in custom database, using provided/default categories');
          }
        } catch (customDbError) {
          console.log('❌ Failed to extract categories from custom database:', customDbError.message);
          console.log('⚠️ Using provided/default categories instead');
        }
      }

      // Generate QR code if website is provided
      let qrCode = null;
      if (website) {
        try {
          qrCode = await generateQRCode(website);
          console.log(`✅ QR code generated for website: ${website}`);
        } catch (qrError) {
          console.log(`⚠️ Failed to generate QR code for website: ${website}`, qrError);
        }
      }

      // Try MongoDB first with timeout, then fallback to mock data
      try {
        const updatePromise = Restaurant.findByIdAndUpdate(
          id,
          { name, description, address, phone, email, image, website, qrCode, mongoUri, customTypes: finalCustomTypes, isActive, otpEnabled },
          { new: true }
        );
        
        const restaurant = await Promise.race([
          updatePromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("MongoDB update timeout")), 2000)
          )
        ]);

        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        console.log(`✅ Restaurant updated successfully: ${restaurant.name}`);
        return res.json(restaurant);
      } catch (mongoError) {
        console.log("MongoDB not available for restaurant update, using mock data fallback");
        
        // Try to find and update in mock data
        const mockRestaurants = getMockRestaurants();
        const mockIndex = mockRestaurants.findIndex(r => r._id === id);
        
        if (mockIndex === -1) {
          return res.status(404).json({ message: "Restaurant not found" });
        }
        
        // Update mock restaurant
        const updatedRestaurant = {
          ...mockRestaurants[mockIndex],
          name,
          description,
          address,
          phone,
          email,
          image,
          website,
          qrCode,
          mongoUri,
          customTypes: finalCustomTypes,
          isActive
        };
        
        mockRestaurants[mockIndex] = updatedRestaurant;
        console.log(`✅ Mock restaurant updated successfully: ${updatedRestaurant.name}`);
        return res.json(updatedRestaurant);
      }
    } catch (error) {
      console.error("🚨 Error updating restaurant:", error);
      console.error("🚨 Error stack:", error.stack);
      console.error("🚨 Error name:", error.name);
      res.status(500).json({ 
        message: "Failed to update restaurant", 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Add endpoint to manually force update restaurant categories (for testing)
  app.post("/api/admin/restaurants/:id/force-update-categories", async (req, res) => {
    try {
      const { id } = req.params;
      const restaurant = await Restaurant.findById(id);

      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      if (!restaurant.mongoUri) {
        return res.status(400).json({ message: "Restaurant does not have a MongoDB URI" });
      }

      try {
        console.log(`🔄 Force updating categories for restaurant: ${restaurant.name}`);
        
        const customConnection = await connectToRestaurantDatabase(restaurant.mongoUri);
        const extractedCategories = await extractCategoriesFromCustomDB(customConnection);
        
        if (extractedCategories && extractedCategories.length > 0) {
          restaurant.customTypes = extractedCategories;
          await restaurant.save();
          console.log(`✅ Categories force updated: ${extractedCategories.join(', ')}`);
          res.json({ message: "Categories force updated successfully", categories: extractedCategories, restaurant });
        } else {
          res.status(400).json({ message: "No categories found in custom database" });
        }
      } catch (error) {
        console.error("❌ Failed to force update categories:", error);
        res.status(500).json({ message: "Failed to force update categories", error: error.message });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to force update categories", error: error.message });
    }
  });

  // Add endpoint to refresh categories for existing restaurants
  app.post("/api/admin/restaurants/:id/refresh-categories", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const restaurant = await Restaurant.findById(id);

      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      if (!restaurant.mongoUri) {
        return res.status(400).json({ message: "Restaurant does not have a MongoDB URI" });
      }

      try {
        console.log(`🔄 Refreshing categories for restaurant: ${restaurant.name}`);
        
        const categoryPromise = (async () => {
          const customConnection = await connectToRestaurantDatabase(restaurant.mongoUri);
          return await extractCategoriesFromCustomDB(customConnection);
        })();
        
        const extractedCategories = await Promise.race([
          categoryPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Category extraction timeout")), 5001)
          )
        ]);
        
        if (extractedCategories && extractedCategories.length > 0) {
          restaurant.customTypes = extractedCategories;
          await restaurant.save();
          console.log(`✅ Categories refreshed: ${extractedCategories.join(', ')}`);
          res.json({ message: "Categories refreshed successfully", categories: extractedCategories });
        } else {
          res.status(400).json({ message: "No categories found in custom database" });
        }
      } catch (error) {
        console.error("❌ Failed to refresh categories:", error);
        res.status(500).json({ message: "Failed to refresh categories" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to refresh categories" });
    }
  });

  app.delete("/api/admin/restaurants/:id", authenticateAdmin, async (req, res) => {
    try {
      const admin = (req as any).admin;
      const isAdminUsername = admin.username?.toLowerCase() === 'admin';
      const isMasterRole = admin.role === 'master';
      const isMaster = isMasterRole || isAdminUsername;

      if (!isMaster) {
        return res.status(403).json({ message: "Only Master Admin can delete restaurants" });
      }
      const { id } = req.params;
      
      // Try MongoDB first with quick timeout, then fallback
      try {
        const deletePromise = (async () => {
          const restaurant = await Restaurant.findByIdAndDelete(id);
          if (restaurant) {
            await MenuItem.deleteMany({ restaurantId: id });
            return restaurant;
          }
          return null;
        })();
        
        const restaurant = await Promise.race([
          deletePromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("MongoDB timeout")), 5000)
          )
        ]);
        
        if (restaurant) {
          return res.json({ message: "Restaurant deleted successfully" });
        }
      } catch (mongoError) {
        // MongoDB not available or timeout, delete from mock data quickly
        console.log("MongoDB not available for deletion, removing from mock data");
        if (deleteMockRestaurant(id)) {
          return res.json({ message: "Restaurant deleted successfully" });
        }
      }

      return res.status(404).json({ message: "Restaurant not found" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete restaurant" });
    }
  });

  // Menu Item Management Routes
  
  // Get menu items by category (collection-based)
  app.get("/api/admin/restaurants/:restaurantId/menu-items/category/:category", authenticateAdmin, async (req, res) => {
    try {
      const { restaurantId, category } = req.params;
      console.log(`🎯 Fetching menu items for restaurant ${restaurantId}, category: ${category}`);
      
      // First get the restaurant
      let restaurant = null;
      try {
        restaurant = await Promise.race([
          Restaurant.findById(restaurantId),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("MongoDB timeout")), 5000)
          )
        ]);
      } catch (mongoError) {
        // MongoDB not available, try mock data
        const mockRestaurants = getMockRestaurants();
        restaurant = mockRestaurants.find(r => r._id === restaurantId);
      }
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // If restaurant has custom MongoDB URI, fetch items from specific collection
      if (restaurant.mongoUri) {
        try {
          console.log(`📡 Connecting to custom database for category: ${category}`);
          
          const fetchPromise = (async () => {
            const customConnection = await connectToRestaurantDatabase(restaurant.mongoUri);
            return await fetchMenuItemsFromCustomDB(customConnection, category);
          })();
          
          const menuItems = await Promise.race([
            fetchPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Database fetch timeout")), 3000)
            )
          ]);
          
          console.log(`✅ Found ${menuItems.length} items in category "${category}"`);
          res.json(menuItems);
        } catch (customDbError) {
          console.error(`❌ Failed to fetch category "${category}" from custom database:`, customDbError.message);
          // Fallback to main database
          try {
            const menuItems = await MenuItem.find({ 
              restaurantId, 
              category: new RegExp(category, 'i') 
            }).sort({ createdAt: -1 });
            res.json(menuItems);
          } catch (fallbackError) {
            console.log("Main database also failed, returning empty array");
            res.json([]);
          }
        }
      } else {
        // No custom URI, use main database
        try {
          const menuItems = await MenuItem.find({ 
            restaurantId, 
            category: new RegExp(category, 'i') 
          }).sort({ createdAt: -1 });
          res.json(menuItems);
        } catch (error) {
          console.log("Main database failed, returning mock menu items");
          const mockItems = getMockMenuItems(restaurantId);
          const filteredItems = mockItems.filter(item => 
            item.category.toLowerCase().includes(category.toLowerCase())
          );
          res.json(filteredItems);
        }
      }
    } catch (error) {
      console.error("Error fetching menu items by category:", error);
      res.status(500).json({ message: "Failed to fetch menu items" });
    }
  });

  app.get("/api/admin/restaurants/:restaurantId/menu-items", authenticateAdmin, async (req, res) => {
    try {
      const { restaurantId } = req.params;
      
      // Disable caching for menu items
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'ETag': null
      });
      
      // First get the restaurant with quick timeout
      let restaurant = null;
      try {
        restaurant = await Promise.race([
          Restaurant.findById(restaurantId),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("MongoDB timeout")), 5000)
          )
        ]);
      } catch (mongoError) {
        // MongoDB not available or timeout, try mock data quickly
        const mockRestaurants = getMockRestaurants();
        restaurant = mockRestaurants.find(r => r._id === restaurantId);
      }
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // If restaurant has custom MongoDB URI, connect to it and fetch menu items
      if (restaurant.mongoUri) {
        try {
          console.log(`Fetching menu items from custom database for restaurant: ${restaurant.name}`);
          
          // Set timeout for database operations
          const fetchPromise = (async () => {
            const customConnection = await connectToRestaurantDatabase(restaurant.mongoUri);
            return await fetchMenuItemsFromCustomDB(customConnection);
          })();
          
          // Race against timeout  
          const menuItems = await Promise.race([
            fetchPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Database fetch timeout")), 120000)
            )
          ]);
          
          console.log(`Found ${menuItems.length} menu items in custom database`);
          
          // Auto-update restaurant categories if they don't match extracted ones
          try {
            const customConnection = await connectToRestaurantDatabase(restaurant.mongoUri);
            const extractedCategories = await extractCategoriesFromCustomDB(customConnection);
            
            console.log(`🔍 Current restaurant categories: [${(restaurant.customTypes || []).join(', ')}]`);
            console.log(`🔍 Extracted categories: [${(extractedCategories || []).join(', ')}]`);
            
            if (extractedCategories && extractedCategories.length > 0) {
              const currentCategories = restaurant.customTypes || [];
              // Force update if current categories are empty or different
              const shouldUpdate = currentCategories.length === 0 || 
                                 JSON.stringify(currentCategories.sort()) !== JSON.stringify(extractedCategories.sort());
              
              if (shouldUpdate) {
                console.log(`🔄 Auto-updating restaurant categories from [${currentCategories.join(', ')}] to [${extractedCategories.join(', ')}]`);
                restaurant.customTypes = extractedCategories;
                await restaurant.save();
                console.log('✅ Restaurant categories updated successfully');
                
                // Reload restaurant from database to confirm update
                const updatedRestaurant = await Restaurant.findById(restaurant._id);
                console.log(`🔍 Confirmed updated categories: [${(updatedRestaurant?.customTypes || []).join(', ')}]`);
              } else {
                console.log('📋 Categories are already up to date');
              }
            }
          } catch (categoryError) {
            console.log('❌ Failed to auto-update categories:', categoryError.message);
          }
          
          res.json(menuItems);
        } catch (customDbError) {
          console.error("Failed to fetch from custom database:", customDbError.message);
          // Fall back to main database
          try {
            const menuItems = await MenuItem.find({ restaurantId }).sort({ createdAt: -1 });
            res.json(menuItems);
          } catch (fallbackError) {
            console.log("Main database also failed, returning mock menu items");
            res.json(getMockMenuItems(restaurantId));
          }
        }
      } else {
        // No custom URI, use main database
        try {
          const menuItems = await MenuItem.find({ restaurantId }).sort({ createdAt: -1 });
          res.json(menuItems);
        } catch (mongoError) {
          // MongoDB not available, return mock menu items
          console.log("MongoDB not available for menu items, returning mock data");
          res.json(getMockMenuItems(restaurantId));
        }
      }
    } catch (error) {
      console.error("Error fetching menu items:", error);
      res.status(500).json({ message: "Failed to fetch menu items" });
    }
  });

  app.post("/api/admin/restaurants/:restaurantId/menu-items", authenticateAdmin, async (req, res) => {
    try {
      const { restaurantId } = req.params;
      const { name, description, price, category, isVeg, image } = req.body;

      if (!name || !description || price === undefined || !category || isVeg === undefined || !image) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Get the restaurant to check if it has a custom MongoDB URI
      const restaurant = await Restaurant.findById(restaurantId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // If restaurant has custom MongoDB URI, create in custom database
      if (restaurant.mongoUri) {
        try {
          console.log(`Creating menu item in custom database for restaurant: ${restaurant.name}`);
          const customConnection = await connectToRestaurantDatabase(restaurant.mongoUri);
          
          const menuItem = await createMenuItemInCustomDB(customConnection, {
            name, description, price, category, isVeg, image
          });
          
          res.status(201).json(menuItem);
        } catch (customDbError) {
          console.error("Failed to create in custom database:", customDbError);
          // Fall back to main database
          const menuItem = new MenuItem({
            name, description, price, category, isVeg, image, restaurantId
          });
          await menuItem.save();
          res.status(201).json(menuItem);
        }
      } else {
        // No custom URI, use main database
        try {
          const menuItem = new MenuItem({
            name, description, price, category, isVeg, image, restaurantId
          });

          await menuItem.save();
          res.status(201).json(menuItem);
        } catch (mongoError) {
          // MongoDB not available, add to mock data store
          console.log("MongoDB not available for menu item creation, using mock data store");
          const mockMenuItem = addMockMenuItem({ name, description, price, category, isVeg, image, restaurantId });
          res.status(201).json(mockMenuItem);
        }
      }
    } catch (error) {
      console.error("Error creating menu item:", error);
      res.status(500).json({ message: "Failed to create menu item" });
    }
  });

  app.put("/api/admin/menu-items/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, price, category, isVeg, image, isAvailable, restaurantId } = req.body;

      // Get the restaurant to check if it has a custom MongoDB URI
      const restaurant = await Restaurant.findById(restaurantId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // If restaurant has custom MongoDB URI, update in custom database
      if (restaurant.mongoUri) {
        try {
          console.log(`Updating menu item in custom database for restaurant: ${restaurant.name}`);
          const customConnection = await connectToRestaurantDatabase(restaurant.mongoUri);
          
          const menuItem = await updateMenuItemInCustomDB(customConnection, id, {
            name, description, price, category, isVeg, image, isAvailable
          });
          
          res.json(menuItem);
        } catch (customDbError) {
          console.error("Failed to update in custom database:", customDbError);
          // Fall back to main database
          const menuItem = await MenuItem.findByIdAndUpdate(
            id,
            { name, description, price, category, isVeg, image, isAvailable },
            { new: true }
          );
          
          if (!menuItem) {
            return res.status(404).json({ message: "Menu item not found" });
          }
          res.json(menuItem);
        }
      } else {
        // No custom URI, use main database
        const menuItem = await MenuItem.findByIdAndUpdate(
          id,
          { name, description, price, category, isVeg, image, isAvailable },
          { new: true }
        );

        if (!menuItem) {
          return res.status(404).json({ message: "Menu item not found" });
        }

        res.json(menuItem);
      }
    } catch (error) {
      console.error("Error updating menu item:", error);
      res.status(500).json({ message: "Failed to update menu item" });
    }
  });

  app.delete("/api/admin/menu-items/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { restaurantId } = req.body;

      // Get the restaurant to check if it has a custom MongoDB URI
      const restaurant = await Restaurant.findById(restaurantId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // If restaurant has custom MongoDB URI, delete from custom database
      if (restaurant.mongoUri) {
        try {
          console.log(`Deleting menu item from custom database for restaurant: ${restaurant.name}`);
          const customConnection = await connectToRestaurantDatabase(restaurant.mongoUri);
          
          await deleteMenuItemFromCustomDB(customConnection, id);
          res.json({ message: "Menu item deleted successfully" });
        } catch (customDbError) {
          console.error("Failed to delete from custom database:", customDbError);
          // Fall back to main database
          const menuItem = await MenuItem.findByIdAndDelete(id);
          
          if (!menuItem) {
            return res.status(404).json({ message: "Menu item not found" });
          }
          res.json({ message: "Menu item deleted successfully" });
        }
      } else {
        // No custom URI, use main database
        const menuItem = await MenuItem.findByIdAndDelete(id);

        if (!menuItem) {
          return res.status(404).json({ message: "Menu item not found" });
        }

        res.json({ message: "Menu item deleted successfully" });
      }
    } catch (error) {
      console.error("Error deleting menu item:", error);
      res.status(500).json({ message: "Failed to delete menu item" });
    }
  });

  // Bulk Menu Import - Download Template
  app.get("/api/admin/restaurants/:restaurantId/menu-template", authenticateAdmin, async (req, res) => {
    try {
      const { restaurantId } = req.params;

      // Get the restaurant to check available categories
      const restaurant = await Restaurant.findById(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Get categories for this restaurant (use exact collection names)
      let categories = ['Starters', 'Main Course', 'Desserts', 'Beverages'];
      
      if (restaurant.mongoUri) {
        try {
          // Get raw collection names without mapping for bulk import
          const connection = await connectToRestaurantDatabase(restaurant.mongoUri);
          const collections = await connection.db.listCollections().toArray();
          
          // Filter out system collections
          const systemCollections = ['admin', 'local', 'config', 'system', 'test', 'users', 'sessions', 'accounts', 'tokens'];
          const menuCollections = collections.filter(c => 
            !systemCollections.some(sys => c.name.toLowerCase().includes(sys.toLowerCase())) &&
            !c.name.startsWith('_') &&
            !c.name.startsWith('system.')
          );
          
          if (menuCollections.length > 0) {
            // Use exact collection names as categories for bulk import
            categories = menuCollections.map(c => c.name).sort();
            console.log('📋 Using exact collection names as categories for bulk import:', categories);
          }
        } catch (error) {
          console.warn('Failed to get custom categories, using defaults');
        }
      }

      // Create Excel template with sample data
      const templateData = [
        {
          Name: 'Chicken Biryani',
          Description: 'Aromatic basmati rice cooked with tender chicken pieces',
          Price: 299,
          Category: categories[0] || 'Starters',
          IsVeg: false,
          Image: 'https://example.com/chicken-biryani.jpg',
          IsAvailable: true
        },
        {
          Name: 'Paneer Butter Masala',
          Description: 'Soft paneer cubes in rich tomato and butter gravy',
          Price: 249,
          Category: categories[1] || 'Main Course',
          IsVeg: true,
          Image: 'https://example.com/paneer-butter-masala.jpg',
          IsAvailable: true
        }
      ];

      // Create workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(templateData);

      // Add some formatting and notes
      ws['!cols'] = [
        { width: 20 }, // Name
        { width: 40 }, // Description
        { width: 10 }, // Price
        { width: 15 }, // Category
        { width: 10 }, // IsVeg
        { width: 30 }, // Image
        { width: 12 }  // IsAvailable
      ];

      // Add the worksheet to the workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Menu Items');

      // Add a categories sheet for reference
      const categoriesWs = XLSX.utils.json_to_sheet(
        categories.map(cat => ({ 'Available Categories': cat }))
      );
      XLSX.utils.book_append_sheet(wb, categoriesWs, 'Categories');

      // Generate buffer
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      // Set headers for file download
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="menu-template-${restaurantId}.xlsx"`);
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);
    } catch (error) {
      console.error('Error generating template:', error);
      res.status(500).json({ message: "Failed to generate template" });
    }
  });

  // Bulk Menu Import - Process uploaded file
  app.post("/api/admin/restaurants/:restaurantId/menu-import", authenticateAdmin, upload.single('menuFile'), async (req, res) => {
    try {
      const { restaurantId } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Get the restaurant
      const restaurant = await Restaurant.findById(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Read the Excel file
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      let inserted = 0;
      let updated = 0;
      let failed = 0;
      const errors: string[] = [];

      // Process each row
      for (let i = 0; i < jsonData.length; i++) {
        const row: any = jsonData[i];
        
        try {
          // Validate required fields
          const name = row.Name || row.name;
          const description = row.Description || row.description;
          const price = row.Price ? String(row.Price) : (row.price ? String(row.price) : '0');
          const category = row.Category || row.category;
          const isVeg = row.IsVeg === true || row.IsVeg === 'TRUE' || row.IsVeg === 'true' || row.isVeg === true;
          const image = row.Image || row.image || 'https://via.placeholder.com/300x200?text=Menu+Item';
          const isAvailable = row.IsAvailable !== false && row.IsAvailable !== 'FALSE' && row.IsAvailable !== 'false';

          if (!name || !description || !price || !category) {
            errors.push(`Row ${i + 2}: Missing required fields (Name, Description, Price, Category)`);
            failed++;
            continue;
          }

          const menuItemData = {
            name,
            description,
            price,
            category,
            isVeg,
            image,
            isAvailable,
            restaurantId
          };

          // Upsert menu item using exact collection name matching (update if exists, insert if new)
          if (restaurant.mongoUri) {
            const connection = await connectToRestaurantDatabase(restaurant.mongoUri);
            const targetCollection = category; // Use category as exact collection name

            // Verify collection exists
            const collections = await connection.db.listCollections().toArray();
            const collectionExists = collections.some(c => c.name === targetCollection);

            if (!collectionExists) {
              throw new Error(`Collection "${targetCollection}" does not exist. Available collections: ${collections.map(c => c.name).join(', ')}`);
            }

            // Match by name (case-insensitive) within the same collection
            const filter = { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } };

            const updateDoc = {
              $set: {
                name,
                description,
                price,
                category: targetCollection,
                isVeg,
                image,
                restaurantId: new mongoose.Types.ObjectId(restaurantId),
                isAvailable,
                updatedAt: new Date(),
              },
              $setOnInsert: {
                createdAt: new Date(),
                __v: 0,
              }
            };

            const result = await connection.db.collection(targetCollection).updateOne(filter, updateDoc, { upsert: true });
            if (result.upsertedCount > 0) {
              console.log(`✅ Menu item inserted into collection: ${targetCollection} — "${name}"`);
              inserted++;
            } else {
              console.log(`✅ Menu item updated in collection: ${targetCollection} — "${name}"`);
              updated++;
            }
          } else {
            // Upsert using regular database
            const existing = await MenuItem.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, restaurantId: restaurant._id });
            await MenuItem.findOneAndUpdate(
              { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, restaurantId: restaurant._id },
              { ...menuItemData, restaurantId: restaurant._id, updatedAt: new Date() },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            if (existing) { updated++; } else { inserted++; }
          }
        } catch (error: any) {
          console.error(`Error processing row ${i + 2}:`, error);
          errors.push(`Row ${i + 2}: ${error.message || 'Unknown error'}`);
          failed++;
        }
      }

      // Clean up uploaded file
      try {
        fs.unlinkSync(file.path);
      } catch (cleanupError) {
        console.warn('Failed to cleanup uploaded file:', cleanupError);
      }

      const imported = inserted + updated;
      res.json({
        success: failed === 0,
        message: `Import completed. ${inserted} item(s) added, ${updated} item(s) updated, ${failed} failed.`,
        imported,
        inserted,
        updated,
        failed,
        errors: errors.slice(0, 10) // Limit to first 10 errors
      });

    } catch (error) {
      console.error('Error processing bulk import:', error);
      res.status(500).json({ message: "Failed to process import" });
    }
  });

  // Admin Settings Routes
  app.use("/api/admin/settings", adminSettingsRoutes);
  
  // Additional admin routes for export and logs  
  app.use("/api/admin", adminSettingsRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
