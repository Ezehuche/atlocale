#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import * as flatten from 'flattenjs';
import * as fs from 'fs';
import { omit } from 'lodash';
import * as path from 'path';
import { diff } from 'deep-object-diff';
import ncp from 'ncp';
import fse from 'fs-extra';

import { serviceMap, TranslationService } from './services';
import {
  loadTranslations,
  getAvailableLanguages,
  fixSourceInconsistencies,
  evaluateFilePath,
  FileType,
  DirectoryStructure,
  TranslatableFile,
  JSONValue,
} from './util/file-system';
import { matcherMap } from './matchers';

require('dotenv').config();
const program = new Command();
const options = program.opts();

program
  .option(
    '-i, --input <inputDir>',
    'the directory containing language directories',
    // '.',
  )
  .option(
    '--cache <cacheDir>',
    'set the cache directory',
    '.atlocale',
  )
  .option(
    '-l, --source-language <sourceLang>',
    'specify the source language',
    // 'en',
  )
  .option(
    '-t, --type <key-based|natural|auto>',
    `specify the file structure type`,
    /^(key-based|natural|auto)$/,
    // 'auto',
  )
  .option(
    '-s, --service <service>',
    `selects the service to be used for translation`,
    // 'google-translate',
  )
  .option('--list-services', `outputs a list of available services`)
  .option(
    '-m, --matcher <matcher>',
    `selects the matcher to be used for interpolations`,
    // 'icu',
  )
  .option('--list-matchers', `outputs a list of available matchers`)
  .option(
    '-c, --config <value>',
    'supply a config parameter (e.g. path to key file) to the translation service',
  )
  .option(
    '-f, --fix-inconsistencies',
    `automatically fixes inconsistent key-value pairs by setting the value to the key`,
  )
  .option(
    '-d, --delete-unused-strings',
    `deletes strings in translation files that don't exist in the template`,
  )
  .option(
    '--directory-structure <default|ngx-translate>',
    'the locale directory structure',
  )
  .option(
    '--decode-escapes',
    'decodes escaped HTML entities like &#39; into normal UTF-8 characters',
  )
  .parse(process.argv);

const translate = async (
  inputDir: string,
  cacheDir: string = '.atlocale',
  sourceLang: string,
  deleteUnusedStrings = false,
  fileType: FileType,
  dirStructure: DirectoryStructure,
  fixInconsistencies = false,
  service: keyof typeof serviceMap,
  matcher: keyof typeof matcherMap,
  decodeEscapes = false,
  config?: string,
) => {
  const resolvedCacheDir = path.resolve(process.cwd(), cacheDir);
  const localeDir = path.resolve(process.cwd(), resolvedCacheDir);
  let locales: JSONValue = {};

  if (fs.existsSync(`${localeDir}/locales.json`)) {
    locales = fse.readJsonSync(`${localeDir}/locales.json`);
  }
  inputDir = inputDir || locales['inputDir'];
  dirStructure = dirStructure || locales['dirStructure'] as DirectoryStructure;
  fileType = fileType || locales['fileType'] as FileType;
  sourceLang = sourceLang || locales['sourceLang'] as string;
  service = service || locales['service'] as keyof typeof serviceMap;
  matcher = matcher || locales['matcher'] as keyof typeof matcherMap;
  config = config || locales['config'] as string ;
  decodeEscapes = decodeEscapes || locales['decodeEscapes'] as boolean;
  console.log(inputDir);
  console.log(dirStructure);
  console.log(matcher);
  const workingDir = path.resolve(process.cwd(), inputDir);
  const availableLanguages = getAvailableLanguages(workingDir, dirStructure);
  const targetLanguages = availableLanguages.filter((f) => f !== sourceLang);

  if (!fs.existsSync(resolvedCacheDir)) {
    fs.mkdirSync(resolvedCacheDir);
    const obj = {
      'sourceLang': 'en',
      'targetLangs': [],
      'service': 'google-translate',
      'matcher': 'icu',
      'config': '',
      'fileType': 'auto',
      'dirStructure': 'default',
      'decodeEscapes': false,
    };
    const json = JSON.stringify(obj, null, 2) + '\n';

    fs.writeFileSync(`${localeDir}/locales.json`, json);
    console.log(`🗂 Created the cache directory.`);
  }

  if (!availableLanguages.includes(sourceLang)) {
    throw new Error(`The source language ${sourceLang} doesn't exist.`);
  }

  if (typeof serviceMap[service] === 'undefined') {
    throw new Error(`The service ${service} doesn't exist.`);
  }

  if (typeof matcherMap[matcher] === 'undefined') {
    throw new Error(`The matcher ${matcher} doesn't exist.`);
  }

  const translationService = serviceMap[service];

  const templateFilePath = evaluateFilePath(
    workingDir,
    dirStructure,
    sourceLang,
  );

  const templateFiles = loadTranslations(templateFilePath, fileType);

  if (templateFiles.length === 0) {
    throw new Error(
      `The source language ${sourceLang} doesn't contain any JSON files.`,
    );
  }

  console.log(
    chalk`Found {green.bold ${String(
      targetLanguages.length,
    )}} target language(s):`,
  );
  console.log(`-> ${targetLanguages.join(', ')}`);
  console.log();

  console.log(`🏭 Loading source files...`);
  for (const file of templateFiles) {
    console.log(chalk`├── ${String(file.name)} (${file.type})`);
  }
  console.log(chalk`└── {green.bold Done}`);
  console.log();

  console.log(`✨ Initializing ${translationService.name}...`);
  await translationService.initialize(
    config,
    matcherMap[matcher],
    decodeEscapes,
  );
  console.log(chalk`└── {green.bold Done}`);
  console.log();

  if (!translationService.supportsLanguage(sourceLang)) {
    throw new Error(
      `${translationService.name} doesn't support the source language ${sourceLang}`,
    );
  }

  console.log(`🔍 Looking for key-value inconsistencies in source files...`);
  const inconsistentFiles: string[] = [];

  for (const file of templateFiles.filter((f) => f.type === 'natural')) {
    const inconsistentKeys = Object.keys(file.content).filter(
      (key) => key !== file.content[key],
    );

    if (inconsistentKeys.length > 0) {
      inconsistentFiles.push(file.name);
      console.log(
        chalk`├── {yellow.bold ${file.name} contains} {red.bold ${String(
          inconsistentKeys.length,
        )}} {yellow.bold inconsistent key(s)}`,
      );
    }
  }

  if (inconsistentFiles.length > 0) {
    console.log(
      chalk`└── {yellow.bold Found key-value inconsistencies in} {red.bold ${String(
        inconsistentFiles.length,
      )}} {yellow.bold file(s).}`,
    );

    console.log();

    if (fixInconsistencies) {
      console.log(`💚 Fixing inconsistencies...`);
      fixSourceInconsistencies(
        templateFilePath,
        evaluateFilePath(resolvedCacheDir, dirStructure, sourceLang),
      );
      console.log(chalk`└── {green.bold Fixed all inconsistencies.}`);
    } else {
      console.log(
        chalk`Please either fix these inconsistencies manually or supply the {green.bold -f} flag to automatically fix them.`,
      );
    }
  } else {
    console.log(chalk`└── {green.bold No inconsistencies found}`);
  }
  console.log();

  console.log(`🔍 Looking for invalid keys in source files...`);
  const invalidFiles: string[] = [];

  for (const file of templateFiles.filter((f) => f.type === 'key-based')) {
    const invalidKeys = Object.keys(file.originalContent).filter(
      (k) => typeof file.originalContent[k] === 'string' && k.includes('.'),
    );

    if (invalidKeys.length > 0) {
      invalidFiles.push(file.name);
      console.log(
        chalk`├── {yellow.bold ${file.name} contains} {red.bold ${String(
          invalidKeys.length,
        )}} {yellow.bold invalid key(s)}`,
      );
    }
  }

  if (invalidFiles.length) {
    console.log(
      chalk`└── {yellow.bold Found invalid keys in} {red.bold ${String(
        invalidFiles.length,
      )}} {yellow.bold file(s).}`,
    );

    console.log();
    console.log(
      chalk`It looks like you're trying to use the key-based mode on natural-language-style JSON files.`,
    );
    console.log(
      chalk`Please make sure that your keys don't contain periods (.) or remove the {green.bold --type} / {green.bold -t} option.`,
    );
    console.log();
    process.exit(1);
  } else {
    console.log(chalk`└── {green.bold No invalid keys found}`);
  }
  console.log();

  let totalAddedTranslations = 0;
  let totalRemovedTranslations = 0;

  for (const language of targetLanguages) {
    if (!translationService.supportsLanguage(language)) {
      console.log(
        chalk`🙈 {yellow.bold ${translationService.name} doesn't support} {red.bold ${language}}{yellow.bold . Skipping this language.}`,
      );
      console.log();
      continue;
    }

    console.log(
      chalk`💬 Translating strings from {green.bold ${sourceLang}} to {green.bold ${language}}...`,
    );

    const translateContent = createTranslator(
      translationService,
      service,
      sourceLang,
      language,
      cacheDir,
      workingDir,
      dirStructure,
      deleteUnusedStrings,
    );

    switch (dirStructure) {
      case 'default':
        const existingFiles = loadTranslations(
          evaluateFilePath(workingDir, dirStructure, language),
          fileType,
        );

        if (deleteUnusedStrings) {
          const templateFileNames = templateFiles.map((t) => t.name);
          const deletableFiles = existingFiles.filter(
            (f) => !templateFileNames.includes(f.name),
          );

          for (const file of deletableFiles) {
            console.log(
              chalk`├── {red.bold ${file.name} is no longer used and will be deleted.}`,
            );

            fs.unlinkSync(
              path.resolve(
                evaluateFilePath(workingDir, dirStructure, language),
                file.name,
              ),
            );

            const cacheFile = path.resolve(
              evaluateFilePath(workingDir, dirStructure, language),
              file.name,
            );
            if (fs.existsSync(cacheFile)) {
              fs.unlinkSync(cacheFile);
            }
          }
        }

        for (const templateFile of templateFiles) {
          process.stdout.write(`├── Translating ${templateFile.name}`);

          const [addedTranslations, removedTranslations] =
            await translateContent(
              templateFile,
              existingFiles.find((f) => f.name === templateFile.name),
            );

          totalAddedTranslations += addedTranslations;
          totalRemovedTranslations += removedTranslations;
        }
        break;

      case 'ngx-translate':
        const sourceFile = templateFiles.find(
          (f) => f.name === `${sourceLang}.json`,
        );
        if (!sourceFile) {
          throw new Error('Could not find source file. This is a bug.');
        }
        const [addedTranslations, removedTranslations] = await translateContent(
          sourceFile,
          templateFiles.find((f) => f.name === `${language}.json`),
        );

        totalAddedTranslations += addedTranslations;
        totalRemovedTranslations += removedTranslations;
        break;
    }

    console.log(chalk`└── {green.bold All strings have been translated.}`);
    console.log();
  }

  if (service !== 'dry-run') {
    console.log('🗂 Caching source translation files...');
    await new Promise((res, rej) =>
      ncp(
        evaluateFilePath(workingDir, dirStructure, sourceLang),
        evaluateFilePath(resolvedCacheDir, dirStructure, sourceLang),
        (err) => (err ? rej() : res(null)),
      ),
    );
    console.log(chalk`└── {green.bold Translation files have been cached.}`);
    console.log();
  }

  console.log(
    chalk.green.bold(
      `${totalAddedTranslations} new translations have been added!`,
    ),
  );

  if (totalRemovedTranslations > 0) {
    console.log(
      chalk.green.bold(
        `${totalRemovedTranslations} translations have been removed!`,
      ),
    );
  }
};

if (options.listServices) {
  console.log('Available services:');
  console.log(Object.keys(serviceMap).join(', '));
  process.exit(0);
}

if (options.listMatchers) {
  console.log('Available matchers:');
  console.log(Object.keys(matcherMap).join(', '));
  process.exit(0);
}

translate(
  options.input,
  options.cacheDir,
  options.sourceLanguage,
  options.deleteUnusedStrings,
  options.type,
  options.directoryStructure,
  options.fixInconsistencies,
  options.service,
  options.matcher,
  options.decodeEscapes,
  options.config,
).catch((e: Error) => {
  console.log();
  console.log(chalk.bgRed('An error has occurred:'));
  console.log(chalk.bgRed(e.message));
  console.log(chalk.bgRed(e.stack));
  console.log();
  process.exit(1);
});

function createTranslator(
  translationService: TranslationService,
  service: keyof typeof serviceMap,
  sourceLang: string,
  targetLang: string,
  cacheDir: string,
  workingDir: string,
  dirStructure: DirectoryStructure,
  deleteUnusedStrings: boolean,
) {
  return async (
    sourceFile: TranslatableFile,
    destinationFile: TranslatableFile | undefined,
  ) => {
    const cachePath = path.resolve(
      evaluateFilePath(cacheDir, dirStructure, sourceLang),
      sourceFile ? sourceFile.name : '',
    );
    let cacheDiff: string[] = [];
    if (fs.existsSync(cachePath) && !fs.statSync(cachePath).isDirectory()) {
      const cachedFile = flatten.convert(
        JSON.parse(fs.readFileSync(cachePath).toString().trim()),
      );
      const cDiff = diff(cachedFile, sourceFile.content);
      cacheDiff = Object.keys(cDiff).filter((k) => cDiff[k]);
      const changedItems = Object.keys(cacheDiff).length.toString();
      process.stdout.write(
        chalk` ({green.bold ${changedItems}} changes from cache)`,
      );
    }

    const existingKeys = destinationFile
      ? Object.keys(destinationFile.content)
      : [];
    const templateStrings = Object.keys(sourceFile.content);
    const stringsToTranslate = templateStrings
      .filter((key) => !existingKeys.includes(key) || cacheDiff.includes(key))
      .map((key) => ({
        key,
        value: sourceFile.type === 'key-based' ? sourceFile.content[key] : key,
      }));

    const unusedStrings = existingKeys.filter(
      (key) => !templateStrings.includes(key),
    );

    const translatedStrings = await translationService.translateStrings(
      stringsToTranslate,
      sourceLang,
      targetLang,
    );

    const newKeys = translatedStrings.reduce(
      (acc, cur) => ({ ...acc, [cur.key]: cur.translated }),
      {} as { [k: string]: string },
    );

    if (service !== 'dry-run') {
      const existingTranslations = destinationFile
        ? destinationFile.content
        : {};

      const translatedFile = {
        ...omit(existingTranslations, deleteUnusedStrings ? unusedStrings : []),
        ...newKeys,
      };

      const newContent =
        JSON.stringify(
          sourceFile.type === 'key-based'
            ? flatten.undo(translatedFile)
            : translatedFile,
          null,
          2,
        ) + `\n`;

      fs.writeFileSync(
        path.resolve(
          evaluateFilePath(workingDir, dirStructure, targetLang),
          destinationFile?.name ?? sourceFile.name,
        ),
        newContent,
      );

      const languageCachePath = evaluateFilePath(
        cacheDir,
        dirStructure,
        targetLang,
      );
      if (!fs.existsSync(languageCachePath)) {
        fs.mkdirSync(languageCachePath);
      }
      fs.writeFileSync(
        path.resolve(
          languageCachePath,
          destinationFile?.name ?? sourceFile.name,
        ),
        JSON.stringify(translatedFile, null, 2) + '\n',
      );
    }

    console.log(
      deleteUnusedStrings && unusedStrings.length > 0
        ? chalk` ({green.bold +${String(
            translatedStrings.length,
          )}}/{red.bold -${String(unusedStrings.length)}})`
        : chalk` ({green.bold +${String(translatedStrings.length)}})`,
    );

    // Added translations and removed translations
    return [
      translatedStrings.length,
      deleteUnusedStrings ? unusedStrings.length : 0,
    ];
  };
}
