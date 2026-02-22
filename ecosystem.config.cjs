module.exports = {
  apps: [
    {
      name: "restaurant-management-app",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: 5000,
        CLOUDINARY_CLOUD_NAME: "dnfee6rib",
        CLOUDINARY_API_KEY: "193651557981281",
        CLOUDINARY_API_SECRET: "sRCb0UvRvqeF0cPLS9eSJj52Nms"
      }
    }
  ]
};
