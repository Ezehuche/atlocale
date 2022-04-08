import { 
    TFileType,
    TFileFormat
} from '../util/file-system';

export async function instantiateTFileFormat(
    fileFormat: TFileType
  ): Promise<TFileFormat> {
    /**
     * To improve launch-performance, we import file-formats dynamically.
     */
    switch (fileFormat) {
      case "csv":
        return new (await import("./csv")).SimpleCsv();
    }
  }