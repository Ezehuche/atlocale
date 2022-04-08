import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import {
  ReadTFileArgs,
  WriteTFileArgs,
  TFileFormat,
  TSet,
} from '../util/file-system';

// We might make this configurable if the need arises.
const CSV_SEPARATOR = ',';

interface CsvStruct {
  rawHeader: string;
  languageIndex: number;
  contentLines: string[];
}

function insertCsvCache(filePath: string, lines: string[]) {
  const cacheDir = path.resolve(process.cwd(), '.atlocale/csv');
  const fileName = filePath.replace(/^.*[\\\/]/, '');
  const csv: string = lines.join('\n');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir);

    fs.writeFileSync(`${cacheDir}/${fileName}`, csv);
    console.log(`🗂 Created CSV cache directory.`);
  }
}

function updateCsvCache(filePath: string, lines: string[]) {
  const cacheFile = getCsvCache(filePath);
  const csv: string = lines.join('\n');
  if (cacheFile) {
    fs.appendFileSync(cacheFile, csv, { encoding: 'utf8' });
    console.log(`🗂 Updated cache file.`);
  }
}

function getCsvCache(filePath: string) {
  const cacheDir = path.resolve(process.cwd(), '.atlocale/csv');
  const fileName = filePath.replace(/^.*[\\\/]/, '');
  const cacheFile = `${cacheDir}/${fileName}`;

  if (fs.existsSync(cacheFile)) {
    return cacheFile;
  }

  return null;
}

function checkCsvCache(key: string, filePath: string): boolean {
  const cacheFile = getCsvCache(filePath);
  let value: boolean = false;
  if (cacheFile) {
    fs.createReadStream(cacheFile)
      .on('error', (err) => {
        console.error(`Error reading cache file: ${err}`);
      })
      .pipe(csv())
      .on('data', (row) => {
        if (row['keys'] === key) {
          value = true;
        }
      })
      .on('end', () => {
        if (value) {
          console.log(`🗂 Found key in cache.`);
          return value;
        }
        return value;
      });
  }
  return value;
}

function parseCsvStruct(args: {
  utf8: string;
  args: ReadTFileArgs;
}): CsvStruct {
  const lines: string[] = args.utf8.split('\n');
  if (!lines || lines.length < 2) {
    throw new Error(
      `Expected at least 2 CSV lines (header + content) ${args.args}`,
    );
  }
  const rawHeader = lines[0];
  const header: string[] = rawHeader.split(CSV_SEPARATOR);
  if (!header || header.length < 2) {
    throw new Error(
      `Expected at least 2 columns in CSV header with separator '${CSV_SEPARATOR}' ${args.args}`,
    );
  }
  const languageCodes = header.slice(1);
  const languageIndex =
    1 + languageCodes.findIndex((value) => value.trim() === args.args.lng);
  if (languageIndex <= 0) {
    throw new Error(
      `Did not find language '${args.args.lng}' in CSV header '${rawHeader}'`,
    );
  }
  const contentLines = lines.slice(1);
  contentLines.forEach((line, index) => {
    contentLines[index] = line.replace('\r', '');
  });
  return {
    rawHeader,
    languageIndex,
    contentLines,
  };
}

export class SimpleCsv implements TFileFormat {
  readTFile(args: ReadTFileArgs): Promise<TSet> {
    // insertCsvCache(args.path);
    const utf8 = fs.readFileSync(args.path, { encoding: 'utf8', flag: 'r' });
    const csvStruct = parseCsvStruct({ utf8, args });

    const tSet: TSet = new Map();
    csvStruct.contentLines.forEach((line) => {
      const tokens: string[] = line.split(CSV_SEPARATOR);
      if (tokens.length <= csvStruct.languageIndex) {
        return;
      }
      const key = tokens[0];
      const value = tokens[csvStruct.languageIndex];
      if (tSet.has(key)) {
        throw new Error(
          `duplicate key '${key}' -> Currently, the usage of duplicate translation-keys is discouraged.`,
        );
      }
      tSet.set(key, value);
    });
    return Promise.resolve(tSet);
  }

  writeTFile(args: WriteTFileArgs): void {
    console.log(
      "Warning: Currently, 'atlocale' may overwrite pre-existing CSV-content. This might change in future versions.",
    );
    const cacheFile = getCsvCache(args.path);
    const lines: string[] = [];
    const header: string = ['keys', args.lng].join(CSV_SEPARATOR);
    lines.push(header);
    args.tSet.forEach((value, key) => {
      const cache = checkCsvCache(key, args.path);
      lines.push([key, value].join(CSV_SEPARATOR));
      if (!cache) {
        updateCsvCache(args.path, lines);
      } else {
        insertCsvCache(args.path, lines);
        console.log(`🗂 Found key in cache.`);
      }
    });
    const csv: string = lines.join('\n');
    if (!cacheFile) {
        fs.writeFileSync(args.path, csv, { encoding: 'utf8' });
        console.log(`🗂 Created CSV file.`);
    } else {
        fs.appendFileSync(args.path, csv, { encoding: 'utf8' });
        console.log(`🗂 Updated CSV file.`);
    }
  }
}
