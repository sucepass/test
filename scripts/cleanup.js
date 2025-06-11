import mongoose from 'mongoose';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

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

async function cleanupFailedUploads() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const failedFiles = await File.find({ status: 'failed' });
    console.log(`Found ${failedFiles.length} failed uploads to clean up`);

    for (const file of failedFiles) {
      try {
        // Extract the key from the URL
        const url = new URL(file.url);
        const key = url.pathname.substring(1); // Remove leading slash

        // Delete from S3
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: key,
        }));

        // Delete from database
        await File.deleteOne({ _id: file._id });

        console.log(`Cleaned up file: ${file.originalName}`);
      } catch (error) {
        console.error(`Error cleaning up file ${file.originalName}:`, error);
      }
    }

    console.log('Cleanup completed');
  } catch (error) {
    console.error('Cleanup failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

cleanupFailedUploads(); 