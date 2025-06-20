import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import multer from 'multer';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { body, validationResult } from 'express-validator';
import path from 'path';
import { fileURLToPath } from 'url';
import { s3Client, BUCKET_NAME, PORT } from './config.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://test-five-blue-j2pri7a5m9.vercel.app'] 
    : ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));
app.use(compression());
app.use(express.json());
app.use(morgan('combined'));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  
  // Serve index.html for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Rate limiting
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many upload requests from this IP, please try again later'
});

// MongoDB connection with retry logic
const connectWithRetry = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    throw err; // In serverless, we want to fail fast
  }
};

// File Schema
const fileSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  size: Number,
  mimeType: String,
  url: String,
  status: {
    type: String,
    enum: ['pending', 'uploading', 'completed', 'failed'],
    default: 'pending'
  },
  uploadDate: {
    type: Date,
    default: Date.now
  }
});

const File = mongoose.model('File', fileSchema);

// Allowed file types
const allowedMimeTypes = [
  'image/jpg',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
];

// Multer configuration for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed types: ' + allowedMimeTypes.join(', ')));
    }
  }
});

// S3 Configuration validation
const validateS3Config = () => {
  const requiredEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_BUCKET_NAME'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  if (!BUCKET_NAME) {
    throw new Error('AWS_BUCKET_NAME is not configured');
  }
};

// Validate S3 configuration on startup
try {
  validateS3Config();
  console.log('S3 configuration validated successfully');
} catch (error) {
  console.error('S3 configuration error:', error.message);
  process.exit(1);
}

// Enhanced error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error details:', {
    message: err.message,
    stack: err.stack,
    name: err.name,
    code: err.code
  });
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'File size too large',
        details: 'Maximum file size is 10MB'
      });
    }
    return res.status(400).json({ 
      error: 'File upload error',
      details: err.message 
    });
  }

  if (err.name === 'S3Error') {
    return res.status(500).json({
      error: 'Storage error',
      details: err.message,
      code: err.code
    });
  }

  // Log MongoDB connection errors
  if (err.name === 'MongoServerError' || err.name === 'MongooseError') {
    console.error('MongoDB Error:', {
      name: err.name,
      message: err.message,
      code: err.code
    });
    return res.status(500).json({
      error: 'Database error',
      details: 'Unable to process request due to database issues'
    });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
};

// Upload endpoint with enhanced validation and error handling
app.post('/api/upload', 
  uploadLimiter,
  upload.single('file'),
  async (req, res, next) => {
    try {
      // Connect to MongoDB for each request in serverless environment
      await connectWithRetry();

      // Validate S3 configuration before processing
      validateS3Config();

      if (!req.file) {
        return res.status(400).json({ 
          error: 'No file uploaded',
          details: 'Please select a file to upload'
        });
      }

      const file = req.file;
      const key = `uploads/${Date.now()}-${file.originalname}`;

      try {
        console.log('Attempting to upload to S3:', {
          bucket: BUCKET_NAME,
          key: key,
          fileSize: file.size,
          mimeType: file.mimetype
        });

        const command = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        });

        await s3Client.send(command);
        console.log('Successfully uploaded to S3');

        // Save file metadata to MongoDB
        const fileDoc = new File({
          filename: key,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          url: `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`,
          status: 'completed'
        });

        await fileDoc.save();
        console.log('Successfully saved file metadata to MongoDB');

        // Close MongoDB connection
        await mongoose.connection.close();

        res.json({
          success: true,
          key,
          url: fileDoc.url,
          fileId: fileDoc._id
        });
      } catch (s3Error) {
        console.error('S3 Upload Error:', {
          error: s3Error.message,
          code: s3Error.code,
          requestId: s3Error.$metadata?.requestId
        });

        // Clean up any partial uploads
        try {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key
          });
          await s3Client.send(deleteCommand);
        } catch (cleanupError) {
          console.error('Failed to clean up partial upload:', cleanupError);
        }

        // Close MongoDB connection
        await mongoose.connection.close();
        throw s3Error;
      }
    } catch (error) {
      console.error('Upload endpoint error:', {
        error: error.message,
        stack: error.stack,
        name: error.name
      });
      // Ensure MongoDB connection is closed
      try {
        await mongoose.connection.close();
      } catch (closeError) {
        console.error('Error closing MongoDB connection:', closeError);
      }
      next(error);
    }
  }
);

// Get files endpoint with pagination
app.get('/api/files', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [files, total] = await Promise.all([
      File.find()
        .sort({ uploadDate: -1 })
        .skip(skip)
        .limit(limit),
      File.countDocuments()
    ]);

    res.json({
      files,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Failed to fetch files:', error);
    next(error);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date(),
    services: {
      mongodb: mongoose.connection.readyState === 1,
      s3: !!s3Client
    },
    uptime: process.uptime()
  };
  res.json(health);
});

// Apply error handling middleware
app.use(errorHandler);

// Export the app for Vercel
export default app;

// Only start the server if we're not in a serverless environment
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Health check available at http://localhost:${port}/health`);
  });
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}); 