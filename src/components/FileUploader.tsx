import { useCallback, useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import type { FileRejection } from 'react-dropzone';
import {
  Card,
  Button,
  Banner,
  Text,
  List,
  Icon,
  ProgressBar,
} from '@shopify/polaris';
import { DeleteMajor, UploadMajor, RefreshMajor } from '@shopify/polaris-icons';

/**
 * Interface for files with additional metadata for tracking upload status
 */
interface FileWithMeta extends File {
  status?: 'pending' | 'uploading' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  retryCount?: number;
}

// Constants for configuration
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CONCURRENT_UPLOADS = 2; // Maximum number of concurrent uploads
const MAX_RETRIES = 3; // Maximum number of retry attempts
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function FileUploader() {
  // State for managing files and UI
  const [files, setFiles] = useState<FileWithMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Refs for managing the upload queue and active uploads
  // Using refs instead of state to avoid unnecessary re-renders
  const uploadQueue = useRef<FileWithMeta[]>([]);
  const activeUploads = useRef<number>(0);

  /**
   * Handles file drop events from react-dropzone
   * Validates files and adds them to the files state
   */
  const onDrop = useCallback((acceptedFiles: File[], fileRejections: FileRejection[]) => {
    if (fileRejections.length > 0) {
      const errors = fileRejections.map(rejection => {
        const error = rejection.errors[0]?.message || 'Invalid file';
        return `${rejection.file.name}: ${error}`;
      });
      setError(errors.join('\n'));
      return;
    }
    const validFiles = acceptedFiles.filter(file => {
      if (!(file instanceof File)) return false;
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name} is too large (max 10MB)`);
        return false;
      }
      return true;
    });
    if (validFiles.length === 0) return;
    const newFiles: FileWithMeta[] = validFiles.map(file => {
      const f = file as FileWithMeta;
      f.status = 'pending';
      f.progress = 0;
      f.retryCount = 0;
      return f;
    });
    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
  }, []);

  // Configure dropzone with file type restrictions and size limits
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxSize: MAX_FILE_SIZE,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif'],
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt']
    }
  });

  /**
   * Removes a file from both the files state and upload queue
   */
  const handleRemove = (file: FileWithMeta) => {
    setFiles(prev => prev.filter(f => f !== file));
    uploadQueue.current = uploadQueue.current.filter(f => f !== file);
  };

  /**
   * Uploads a single file and manages its state
   * Handles success, failure, and retry logic with real-time progress tracking
   */
  const uploadFile = async (file: FileWithMeta): Promise<void> => {
    try {
      file.status = 'uploading';
      file.progress = 0;
      setFiles(prev => [...prev]); // trigger re-render

      const formData = new FormData();
      formData.append('file', file);

      // Use XMLHttpRequest for better progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            file.progress = Math.round((event.loaded / event.total) * 100);
            setFiles(prev => [...prev]); // trigger re-render with progress
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
      file.status = 'completed';
      file.progress = 100;
              resolve();
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              reject(new Error(`Invalid server response: ${errorMessage}`));
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              reject(new Error(errorData.error || 'Upload failed'));
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              reject(new Error(`Upload failed with status ${xhr.status}: ${errorMessage}`));
            }
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error occurred'));
        };

        xhr.onabort = () => {
          reject(new Error('Upload was aborted'));
        };

        xhr.open('POST', `${API_URL}/api/upload`);
        xhr.send(formData);
      });

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      file.status = 'failed';
      file.error = errorMsg;
      
      // Add to retry queue if retries are available
      if (file.retryCount && file.retryCount < MAX_RETRIES) {
        file.retryCount++;
        uploadQueue.current.push(file);
      }
    } finally {
      setFiles(prev => [...prev]); // trigger re-render
      activeUploads.current--;
      processQueue(); // Process next file in queue
    }
  };

  /**
   * Processes the upload queue
   * Maintains the maximum number of concurrent uploads
   */
  const processQueue = () => {
    while (activeUploads.current < MAX_CONCURRENT_UPLOADS && uploadQueue.current.length > 0) {
      const file = uploadQueue.current.shift();
      if (file) {
        activeUploads.current++;
        uploadFile(file);
      }
    }
  };

  /**
   * Initiates the upload process for all pending files
   * Adds files to the queue and starts processing
   */
  const handleUpload = async () => {
    setUploading(true);
    setError(null);
    
    // Add all pending files to the queue
    uploadQueue.current = files.filter(f => f.status === 'pending' || f.status === 'failed');
    activeUploads.current = 0;
    
    // Start processing the queue
    processQueue();
    
    setUploading(false);
  };

  /**
   * Handles manual retry of a failed upload
   * Either starts upload immediately or adds to queue
   */
  const handleRetry = (file: FileWithMeta) => {
    file.status = 'pending';
    file.error = undefined;
    file.retryCount = (file.retryCount || 0) + 1;
    setFiles(prev => [...prev]); // trigger re-render
    
    if (activeUploads.current < MAX_CONCURRENT_UPLOADS) {
      activeUploads.current++;
      uploadFile(file);
    } else {
      uploadQueue.current.push(file);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 py-10">
      <Card>
        <Text variant="headingLg" as="h2">Upload Files</Text>
        {error && (
          <Banner title="Error" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}
        <div
          {...getRootProps()}
          className={`Polaris-Card__Section border-2 border-dashed rounded-md p-6 mb-4 text-center cursor-pointer transition-colors duration-200 ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center">
            <Icon source={UploadMajor} />
            <Text as="p" variant="bodyMd">
              {isDragActive ? 'Drop the files here...' : 'Drag and drop files here, or click to select files'}
            </Text>
            <Text as="p" variant="bodySm">
              Maximum file size: 10MB
            </Text>
          </div>
        </div>
        <div className="mb-4">
          <List>
            {files.map((file, idx) => (
              <List.Item key={idx}>
                <div className="flex w-full justify-between items-center">
                  <div>
                    <Text as="span" variant="bodyMd">{file.name}</Text>
                    <Text as="span" variant="bodySm">{(file.size / 1024 / 1024).toFixed(2)} MB</Text>
                  </div>
                  <div className="flex items-center gap-2">
                    {file.status === 'failed' && (
                      <Button
                        icon={RefreshMajor}
                        onClick={() => handleRetry(file)}
                        accessibilityLabel="Retry upload"
                      />
                    )}
                    <Button
                      icon={DeleteMajor}
                      onClick={() => handleRemove(file)}
                      accessibilityLabel="Remove file"
                    />
                  </div>
                </div>
                {file.status === 'uploading' && <ProgressBar progress={file.progress || 0} />}
                {file.status === 'failed' && (
                  <Banner title="Upload failed">
                    {file.error || 'Upload failed'}
                    {file.retryCount && file.retryCount < MAX_RETRIES && (
                      <Text as="p" variant="bodySm">
                        Retry attempt {file.retryCount} of {MAX_RETRIES}
                      </Text>
                    )}
                  </Banner>
                )}
                {file.status === 'completed' && <Banner title="Upload completed">Upload completed</Banner>}
              </List.Item>
            ))}
          </List>
        </div>
        <Button
          fullWidth
          disabled={files.length === 0 || uploading}
          onClick={handleUpload}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </Button>
      </Card>
    </div>
  );
} 