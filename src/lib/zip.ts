import { unzipSync } from 'fflate';
import { ZipProcessingError } from './errors';

export class ZipProcessor {
  static async processZipBlob(blob: Blob): Promise<Map<string, string>> {
    try {
      // Validate input
      if (!(blob instanceof Blob)) {
        throw new ZipProcessingError('Invalid ZIP data provided');
      }

      if (blob.size === 0) {
        throw new ZipProcessingError('Empty ZIP file provided');
      }

      // Convert blob to Uint8Array
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      try {
        // Use synchronous version instead of Promise-based unzip
        const unzipped = unzipSync(uint8Array);
        
        if (Object.keys(unzipped).length === 0) {
          throw new ZipProcessingError('ZIP file contains no files');
        }

        const files = new Map<string, string>();

        // Process each file
        for (const [filename, content] of Object.entries(unzipped)) {
          const decoder = new TextDecoder();
          try {
            const text = decoder.decode(content);
            files.set(filename, text);
          } catch (decodeError) {
            console.error(`Failed to decode file ${filename}:`, decodeError);
            throw new ZipProcessingError(`Failed to decode file ${filename}. The file may be binary or corrupted.`);
          }
        }

        return files;
      } catch (unzipError) {
        if (unzipError instanceof ZipProcessingError) {
          throw unzipError;
        }
        throw new ZipProcessingError('Failed to extract ZIP contents. The file may be corrupted.');
      }
    } catch (error) {
      if (error instanceof ZipProcessingError) {
        throw error;
      }
      throw new ZipProcessingError('Failed to process ZIP file: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }
}
