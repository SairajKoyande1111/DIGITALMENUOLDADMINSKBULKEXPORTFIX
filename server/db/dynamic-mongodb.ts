import mongoose from 'mongoose';

// Dynamic MongoDB connections for restaurant-specific databases
const connectionPool = new Map<string, mongoose.Connection>();

export async function connectToRestaurantDatabase(mongoUri: string): Promise<mongoose.Connection> {
  // If connection already exists, return it
  if (connectionPool.has(mongoUri)) {
    const existingConnection = connectionPool.get(mongoUri);
    if (existingConnection && existingConnection.readyState === 1) {
      return existingConnection;
    }
    // Remove stale connection
    connectionPool.delete(mongoUri);
  }

  try {
    // Parse the MongoDB URI to extract potential database name
    let finalUri = mongoUri;
    let databaseName = null;
    
    console.log(`🔗 Original URI: ${mongoUri.replace(/:[^:]*@/, ':***@')}`);
    
    // Extract database name from cluster name or URI path
    try {
      // Method 1: Try to extract from URI path
      const url = new URL(mongoUri.replace('mongodb+srv://', 'https://'));
      const pathParts = url.pathname.split('/');
      if (pathParts.length > 1 && pathParts[1] && pathParts[1] !== '?') {
        databaseName = pathParts[1];
        console.log(`📊 Database name from URI path: ${databaseName}`);
      }
    } catch (urlError) {
      console.log('⚠️ Could not parse URI path for database name');
    }
    
    // Method 2: Extract from cluster name if no database in path
    if (!databaseName) {
      try {
        // Extract cluster name from the URI (e.g., mingsdb from mingsdb.mmjpnwc.mongodb.net)
        const clusterMatch = mongoUri.match(/@([^.]+)\./);
        if (clusterMatch && clusterMatch[1]) {
          databaseName = clusterMatch[1];
          console.log(`📊 Database name from cluster name: ${databaseName}`);
        }
      } catch (error) {
        console.log('⚠️ Could not extract database name from cluster name');
      }
    }
    
    // Method 3: If still no database name, try appName parameter
    if (!databaseName) {
      try {
        const appNameMatch = mongoUri.match(/appName=([^&]+)/);
        if (appNameMatch && appNameMatch[1]) {
          const appName = appNameMatch[1];
          // Convert appName to lowercase for database name
          databaseName = appName.toLowerCase();
          console.log(`📊 Database name from appName: ${databaseName}`);
        }
      } catch (error) {
        console.log('⚠️ Could not extract database name from appName');
      }
    }
    
    // If we found a database name, ensure it's in the URI
    if (databaseName) {
      if (!mongoUri.includes('/', mongoUri.lastIndexOf('@') + 1) || mongoUri.includes('/?')) {
        // Add database name to URI
        finalUri = mongoUri.replace('?', `/${databaseName}?`);
        console.log(`🔧 Modified URI to include database name: ${finalUri.replace(/:[^:]*@/, ':***@')}`);
      }
    } else {
      // Fallback: use 'restaurant' as default database name
      databaseName = 'restaurant';
      finalUri = mongoUri.replace('?', `/${databaseName}?`);
      console.log(`⚠️ Using fallback database name: ${databaseName}`);
    }
    
    console.log(`🎯 Target database: ${databaseName}`);
    
    // Create new connection with the properly formatted URI
    const connection = await Promise.race([
      mongoose.createConnection(finalUri, {
        connectTimeoutMS: 15000,
        serverSelectionTimeoutMS: 15000,
        maxPoolSize: 5,
        minPoolSize: 1,
        // Explicitly specify the database name
        dbName: databaseName
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Connection timeout")), 20000)
      )
    ]) as mongoose.Connection;
    
    // Store connection for reuse
    connectionPool.set(mongoUri, connection);
    
    console.log(`✅ Connected to cluster: ${mongoUri.split('@')[1]?.split('/')[0] || 'unknown'}`);
    
    // Wait for connection to be ready
    await new Promise((resolve, reject) => {
      if (connection.readyState === 1) {
        resolve(null);
      } else {
        const timeout = setTimeout(() => {
          reject(new Error('Connection ready timeout'));
        }, 3000);
        
        connection.once('connected', () => {
          clearTimeout(timeout);
          resolve(null);
        });
        
        connection.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      }
    });
    
    // Verify the actual database name
    const actualDbName = connection.db?.databaseName;
    console.log(`📊 Actually connected to database: ${actualDbName}`);
    
    if (actualDbName !== databaseName) {
      console.warn(`⚠️ Connected to different database than expected. Expected: ${databaseName}, Actual: ${actualDbName}`);
    }
    
    // Test the connection by listing collections
    try {
      const collections = await connection.db.listCollections().toArray();
      console.log(`✅ Database verified - found ${collections.length} collections: ${collections.map(c => c.name).join(', ')}`);
    } catch (error) {
      console.warn('⚠️ Could not list collections:', error.message);
    }
    
    return connection;
  } catch (error) {
    console.error('❌ Failed to connect to restaurant database:', error);
    throw error;
  }
}

export function closeRestaurantConnection(mongoUri: string) {
  const connection = connectionPool.get(mongoUri);
  if (connection) {
    connection.close();
    connectionPool.delete(mongoUri);
    console.log(`Closed connection to restaurant database: ${mongoUri.split('@')[1]?.split('/')[0] || 'unknown'}`);
  }
}

// Define Image schema for restaurant-specific database
export function getImageModel(connection: mongoose.Connection) {
  const imageSchema = new mongoose.Schema({
    data: {
      type: String, // Base64 encoded image data
      required: true
    },
    mimeType: {
      type: String,
      default: 'image/jpeg'
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400 * 30 // Auto-delete after 30 days if not referenced
    }
  });

  return connection.model('Image', imageSchema, 'images');
}

// Define flexible menu item schema for dynamic connections
export function getMenuItemModel(connection: mongoose.Connection) {
  const menuItemSchema = new mongoose.Schema({
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true
    },
    price: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true
    },
    isVeg: {
      type: Boolean,
      required: true
    },
    image: {
      type: String,
      required: true
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    isAvailable: {
      type: Boolean,
      default: true
    }
  }, { 
    strict: false, 
    timestamps: true 
  });

  // Use existing model if already compiled
  if (connection.models['MenuItem']) {
    return connection.models['MenuItem'];
  }
  
  return connection.model('MenuItem', menuItemSchema);
}

// Helper function to ensure we're connected to the right database
async function ensureCorrectDatabase(connection: mongoose.Connection, mongoUri: string) {
  try {
    const currentDbName = connection.db?.databaseName;
    console.log(`🔍 Current database: ${currentDbName}`);
    
    // If connected to 'test' database, try to switch to the intended database
    if (currentDbName === 'test' || !currentDbName) {
      console.log('⚠️ Connected to test database or undefined database, attempting to identify correct database');
      
      // Extract intended database name from URI or cluster name
      let intendedDbName = null;
      
      // Method 1: From cluster name
      const clusterMatch = mongoUri.match(/@([^.]+)\./);
      if (clusterMatch && clusterMatch[1]) {
        intendedDbName = clusterMatch[1];
      }
      
      // Method 2: From appName
      if (!intendedDbName) {
        const appNameMatch = mongoUri.match(/appName=([^&]+)/);
        if (appNameMatch && appNameMatch[1]) {
          intendedDbName = appNameMatch[1].toLowerCase();
        }
      }
      
      if (intendedDbName) {
        console.log(`🔄 Switching to database: ${intendedDbName}`);
        // Switch to the intended database
        const targetDb = connection.db.client.db(intendedDbName);
        // Update the connection's db reference
        (connection as any).db = targetDb;
        console.log(`✅ Switched to database: ${targetDb.databaseName}`);
      }
    }
    
    return connection;
  } catch (error) {
    console.error('❌ Error ensuring correct database:', error);
    return connection;
  }
}

// Function to detect and analyze database structure dynamically
export async function analyzeCustomDatabase(connection: mongoose.Connection, mongoUri?: string) {
  try {
    // Ensure we're connected to the correct database
    if (mongoUri) {
      connection = await ensureCorrectDatabase(connection, mongoUri);
    }
    
    const dbName = connection.db?.databaseName;
    console.log('🔍 Analyzing database structure');
    console.log('📊 Database name:', dbName);
    console.log('🔗 Connection state:', connection.readyState);
    
    if (!dbName) {
      console.error('❌ Cannot determine database name from connection');
      return [];
    }
    
    // Check if we're in the test database and try to find the actual database
    if (dbName === 'test') {
      console.log('⚠️ Connected to test database, attempting to find actual restaurant database');
      
      // Try to list all databases to find potential restaurant databases
      try {
        const adminDb = connection.db.admin();
        const { databases } = await adminDb.listDatabases();
        
        console.log('📋 Available databases:', databases.map(db => db.name));
        
        // Look for non-system databases
        const restaurantDbs = databases.filter(db => 
          !['admin', 'local', 'config', 'test'].includes(db.name)
        );
        
        if (restaurantDbs.length > 0) {
          // Switch to the first non-system database
          const targetDbName = restaurantDbs[0].name;
          console.log(`🔄 Switching from test database to: ${targetDbName}`);
          
          const targetDb = connection.db.client.db(targetDbName);
          (connection as any).db = targetDb;
          
          console.log(`✅ Successfully switched to database: ${targetDb.databaseName}`);
        }
      } catch (adminError) {
        console.warn('⚠️ Could not list databases (may need admin privileges):', adminError.message);
      }
    }
    
    const finalDbName = connection.db?.databaseName;
    console.log('📊 Final database name:', finalDbName);
    
    // Get all collections in the database
    const collections = await connection.db.listCollections().toArray();
    console.log('📋 Available collections:', collections.map(c => c.name));
    
    if (collections.length === 0) {
      console.log('📭 No collections found in database, this might indicate connection to wrong database');
      return [];
    }
    
    // Filter collections dynamically - exclude system collections
    const systemCollectionNames = [
      'admin', 'local', 'config', 'system', 'test', 
      'users', 'sessions', 'accounts', 'tokens'
    ];
    
    const menuCollections = collections.filter(c => 
      // Skip collections that start with system prefixes
      !c.name.startsWith('__') && 
      !c.name.startsWith('system.') &&
      !c.name.startsWith('_') &&
      // Skip known system collections
      !systemCollectionNames.some(sys => 
        c.name.toLowerCase().includes(sys.toLowerCase())
      )
    );
    
    console.log('🎯 Menu collections (all non-system collections):', menuCollections.map(c => c.name));
    
    // Analyze each collection to understand its structure
    for (const collection of menuCollections) {
      console.log(`🔍 Analyzing collection: ${collection.name}`);
      
      try {
        const sampleDoc = await connection.db.collection(collection.name).findOne({});
        const docCount = await connection.db.collection(collection.name).countDocuments();
        
        console.log(`📊 Collection "${collection.name}" has ${docCount} documents`);
        
        if (sampleDoc) {
          console.log(`📄 Sample document structure:`, {
            hasName: !!(sampleDoc.name || sampleDoc.title || sampleDoc.itemName),
            hasPrice: !!(sampleDoc.price || sampleDoc.cost || sampleDoc.amount),
            hasDescription: !!(sampleDoc.description || sampleDoc.desc),
            hasCategory: !!(sampleDoc.category || sampleDoc.type),
            hasImage: !!(sampleDoc.image || sampleDoc.imageUrl || sampleDoc.photo),
            keys: Object.keys(sampleDoc).slice(0, 10) // Show first 10 keys
          });
          
          if ((sampleDoc.name || sampleDoc.title) && (sampleDoc.price || sampleDoc.cost)) {
            console.log(`✅ Collection ${collection.name} appears to contain menu items`);
          } else if (docCount > 0) {
            console.log(`⚠️ Collection ${collection.name} has data but structure is unclear`);
          }
        } else {
          console.log(`📭 Collection ${collection.name} is empty (can be used for new items)`);
        }
      } catch (error) {
        console.error(`❌ Error analyzing collection ${collection.name}:`, error);
      }
    }
    
    console.log('🎯 Final menu-related collections found:', menuCollections.map(c => c.name));
    return menuCollections;
  } catch (error) {
    console.error('❌ Error analyzing database structure:', error);
    return [];
  }
}

// Function to fetch menu items from each collection with strict validation
export async function fetchMenuItemsFromCustomDB(connection: mongoose.Connection, categoryFilter?: string, mongoUri?: string) {
  try {
    console.log('🔍 Starting to fetch menu items from custom database with strict validation');
    
    // Ensure we're connected to the correct database
    if (mongoUri) {
      connection = await ensureCorrectDatabase(connection, mongoUri);
    }
    
    const dbName = connection.db?.databaseName;
    console.log('📊 Database name:', dbName);
    console.log('🎯 Category filter:', categoryFilter || 'ALL');
    
    if (!dbName) {
      console.error('❌ Cannot determine database name from connection');
      return [];
    }
    
    // Get all collections in the database
    const collections = await connection.db.listCollections().toArray();
    console.log('📋 Available collections:', collections.map(c => c.name));
    
    // Filter out system collections dynamically
    const systemCollections = ['admin', 'local', 'config', 'system', 'test', 'users', 'sessions', 'accounts', 'tokens'];
    const menuCollections = collections.filter(c => 
      !systemCollections.some(sys => c.name.toLowerCase().includes(sys.toLowerCase())) &&
      !c.name.startsWith('_') &&
      !c.name.startsWith('system.')
    );
    
    console.log('🎯 Menu collections:', menuCollections.map(c => c.name));
    
    if (menuCollections.length === 0) {
      console.log('❌ No menu collections found in custom database');
      return [];
    }
    
    let allMenuItems = [];
    
    // If categoryFilter is provided, find the matching collection by exact name
    let collectionsToQuery = menuCollections;
    if (categoryFilter) {
      // Direct match with collection name (exact match)
      collectionsToQuery = menuCollections.filter(c => 
        c.name === categoryFilter
      );
      
      console.log(`🎯 Filtering for category "${categoryFilter}", found collections:`, collectionsToQuery.map(c => c.name));
    }
    
    // Parallel fetching for faster results
    const fetchPromises = collectionsToQuery.map(async (collection) => {
      try {
        console.log(`🔍 Fetching items from collection: ${collection.name}`);
        
        // Get all items from collection
        const items = await Promise.race([
          connection.db.collection(collection.name).find({}).toArray(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Collection query timeout")), 30000)
          )
        ]) as any[];
        
        console.log(`📋 Found ${items.length} items in ${collection.name}`);
        
        return items.map(item => ({
          _id: item._id,
          name: item.name || item.title || item.itemName || 'Unknown Item',
          description: item.description || item.desc || item.details || '',
          price: item.price || item.cost || item.amount || 0,
          category: collection.name,
          isVeg: item.isVeg ?? item.veg ?? item.vegetarian ?? true,
          image: item.image || item.imageUrl || item.photo || '',
          restaurantId: item.restaurantId || new mongoose.Types.ObjectId(),
          isAvailable: item.isAvailable ?? item.available ?? item.active ?? true,
          createdAt: item.createdAt || new Date(),
          updatedAt: item.updatedAt || new Date(),
          __v: item.__v ?? 0,
          originalCollection: collection.name,
          originalData: item
        }));
      } catch (error) {
        console.error(`❌ Error fetching from collection ${collection.name}:`, error);
        return [];
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    allMenuItems = results
      .filter((result): result is PromiseFulfilledResult<any[]> => result.status === 'fulfilled')
      .map(result => result.value)
      .flat();
    
    console.log(`🎯 Total valid menu items found: ${allMenuItems.length}`);
    return allMenuItems;
  } catch (error) {
    console.error('❌ Error fetching menu items from custom database:', error);
    console.log(`🔥 Returning ${allMenuItems.length} items collected before error`);
    return allMenuItems; // Return what we have collected so far
  }
}

// Function to extract categories from collection names (all collections = categories)
export async function extractCategoriesFromCustomDB(connection: mongoose.Connection, mongoUri?: string) {
  try {
    console.log('🔍 Extracting categories from collection names (all collections = categories)');
    
    // Ensure we're connected to the correct database
    if (mongoUri) {
      connection = await ensureCorrectDatabase(connection, mongoUri);
    }
    
    const dbName = connection.db?.databaseName;
    console.log('📊 Database name:', dbName);
    
    if (!dbName) {
      console.error('❌ Cannot determine database name from connection');
      return ['starters', 'maincourse', 'desserts', 'drinks'];
    }
    
    // Get all collections in the database
    const collections = await connection.db.listCollections().toArray();
    console.log('📋 Available collections:', collections.map(c => c.name));
    
    // Filter out system collections dynamically
    const systemCollections = ['admin', 'local', 'config', 'system', 'test', 'users', 'sessions', 'accounts', 'tokens'];
    const menuCollections = collections.filter(c => 
      !systemCollections.some(sys => c.name.toLowerCase().includes(sys.toLowerCase())) &&
      !c.name.startsWith('_') &&
      !c.name.startsWith('system.')
    );
    
    console.log('🎯 Menu collections (all are valid categories):', menuCollections.map(c => c.name));
    
    if (menuCollections.length === 0) {
      console.log('❌ No valid collections found for categories');
      return ['starters', 'maincourse', 'desserts', 'drinks'];
    }
    
    // Since collection name = category name, use all collection names as categories
    const categories = menuCollections.map(collection => {
      console.log(`✅ Using collection "${collection.name}" as category`);
      return collection.name;
    });
    
    // Remove duplicates and sort
    const uniqueCategories = Array.from(new Set(categories)).sort();
    
    console.log(`✅ All categories from collection names:`, uniqueCategories);
    
    return uniqueCategories.length > 0 ? uniqueCategories : ['starters', 'maincourse', 'desserts', 'drinks'];
  } catch (error) {
    console.error('❌ Error extracting categories from collection names:', error);
    return ['starters', 'maincourse', 'desserts', 'drinks'];
  }
}

// Function to create a menu item in the custom database dynamically
export async function createMenuItemInCustomDB(connection: mongoose.Connection, menuItemData: any, mongoUri?: string) {
  try {
    // Ensure we're connected to the correct database
    if (mongoUri) {
      connection = await ensureCorrectDatabase(connection, mongoUri);
    }
    
    const dbName = connection.db?.databaseName;
    console.log('📊 Creating item in database:', dbName);
    
    const menuCollections = await analyzeCustomDatabase(connection, mongoUri);
    
    // Use the category directly as collection name
    let targetCollection = menuItemData.category?.toLowerCase() || 'menuitems';
    
    // Verify the collection exists in the database
    const collectionExists = menuCollections.some(col => col.name === targetCollection);
    if (!collectionExists) {
      console.log(`⚠️  Collection "${targetCollection}" not found, using first available collection`);
      targetCollection = menuCollections.length > 0 ? menuCollections[0].name : 'menuitems';
    }
    
    console.log(`Creating menu item in collection: ${targetCollection}`);
    
    const transformedData = {
      name: menuItemData.name,
      description: menuItemData.description,
      price: menuItemData.price,
      category: targetCollection, // Use collection name as category
      isVeg: menuItemData.isVeg !== undefined ? menuItemData.isVeg : true, // Use only isVeg field for MongoDB
      image: menuItemData.image,
      restaurantId: menuItemData.restaurantId || new mongoose.Types.ObjectId(),
      isAvailable: menuItemData.isAvailable ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0
    };
    
    const result = await connection.db.collection(targetCollection).insertOne(transformedData);
    console.log(`Menu item created with ID: ${result.insertedId}`);
    
    return {
      _id: result.insertedId,
      ...transformedData,
      originalCollection: targetCollection
    };
  } catch (error) {
    console.error('Error creating menu item in custom database:', error);
    throw error;
  }
}

// Function to update a menu item in the custom database dynamically
export async function updateMenuItemInCustomDB(connection: mongoose.Connection, itemId: string, updateData: any, mongoUri?: string) {
  try {
    // Ensure we're connected to the correct database
    if (mongoUri) {
      connection = await ensureCorrectDatabase(connection, mongoUri);
    }
    
    const dbName = connection.db?.databaseName;
    console.log('📊 Updating item in database:', dbName);
    
    const menuCollections = await analyzeCustomDatabase(connection, mongoUri);
    
    // First, find which collection the item is currently in
    let currentCollection = null;
    let currentItem = null;
    
    for (const collection of menuCollections) {
      try {
        const item = await connection.db.collection(collection.name).findOne(
          { _id: new mongoose.Types.ObjectId(itemId) }
        );
        
        if (item) {
          currentCollection = collection.name;
          currentItem = item;
          break;
        }
      } catch (error) {
        console.error(`Error finding item in collection ${collection.name}:`, error);
      }
    }
    
    if (!currentCollection || !currentItem) {
      throw new Error(`Menu item with ID ${itemId} not found in any collection`);
    }
    
    // If category is being changed, move item to the new collection
    if (updateData.category) {
      const newCollectionName = updateData.category.toLowerCase();
      
      if (newCollectionName !== currentCollection) {
        const newCollectionExists = menuCollections.some(col => col.name === newCollectionName);
      
        if (newCollectionExists) {
          console.log(`🔄 Moving item from "${currentCollection}" to "${newCollectionName}"`);
          
          // Create the item in the new collection with proper field mapping
          const newItemData = {
            ...currentItem,
            ...updateData,
            category: newCollectionName, // Ensure category matches collection name
            isVeg: updateData.isVeg !== undefined ? updateData.isVeg : (currentItem.isVeg ?? currentItem.veg ?? true),
            updatedAt: new Date(),
            __v: currentItem.__v || 0
          };
          // Remove old veg field if it exists
          delete newItemData.veg;
          delete newItemData._id; // Remove old ID for new insertion
          
          const insertResult = await connection.db.collection(newCollectionName).insertOne(newItemData);
          
          // Delete from old collection
          await connection.db.collection(currentCollection).deleteOne(
            { _id: new mongoose.Types.ObjectId(itemId) }
          );
          
          console.log(`✅ Menu item moved to collection: ${newCollectionName}`);
          return {
            _id: insertResult.insertedId,
            ...newItemData,
            originalCollection: newCollectionName
          };
        }
      }
    }
    
    // Update in current collection with proper field mapping
    const updateFields = {
      ...updateData,
      category: currentCollection, // Ensure category matches collection name
      updatedAt: new Date()
    };
    
    // Remove old veg field and ensure isVeg is used
    if (updateFields.veg !== undefined) {
      delete updateFields.veg; // Remove old veg field
    }
    
    const result = await connection.db.collection(currentCollection).findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(itemId) },
      { 
        $set: updateFields
      },
      { returnDocument: 'after' }
    );
    
    if (result) {
      console.log(`✅ Menu item updated in collection: ${currentCollection}`);
      return {
        _id: result._id,
        name: result.name || result.title || result.itemName || 'Unknown Item',
        description: result.description || result.desc || result.details || '',
        price: result.price || result.cost || result.amount || 0,
        category: currentCollection, // Use collection name as category
        isVeg: result.isVeg ?? result.vegetarian ?? result.veg ?? true,
        image: result.image || result.imageUrl || result.photo || '',
        isAvailable: result.isAvailable ?? result.available ?? result.active ?? true,
        originalCollection: currentCollection,
        originalData: result
      };
    }
    
    throw new Error('Menu item not found in any collection');
  } catch (error) {
    console.error('Error updating menu item in custom database:', error);
    throw error;
  }
}

// Function to delete a menu item from the custom database dynamically
export async function deleteMenuItemFromCustomDB(connection: mongoose.Connection, itemId: string, mongoUri?: string) {
  try {
    // Ensure we're connected to the correct database
    if (mongoUri) {
      connection = await ensureCorrectDatabase(connection, mongoUri);
    }
    
    const dbName = connection.db?.databaseName;
    console.log('📊 Deleting item from database:', dbName);
    
    const menuCollections = await analyzeCustomDatabase(connection, mongoUri);
    
    // Try to find and delete the item from all collections
    for (const collection of menuCollections) {
      try {
        const result = await connection.db.collection(collection.name).deleteOne(
          { _id: new mongoose.Types.ObjectId(itemId) }
        );
        
        if (result.deletedCount > 0) {
          console.log(`Menu item deleted from collection: ${collection.name}`);
          return true;
        }
      } catch (error) {
        console.error(`Error deleting from collection ${collection.name}:`, error);
      }
    }
    
    throw new Error('Menu item not found in any collection');
  } catch (error) {
    console.error('Error deleting menu item from custom database:', error);
    throw error;
  }
}