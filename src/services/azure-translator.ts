import fetch from 'node-fetch';
import { chunk, flatten } from 'lodash';
import { decode } from 'html-entities';

import { TranslationService, TranslationResult, TString } from '.';
import {
  Matcher,
  reInsertInterpolations,
  replaceInterpolations,
} from '../matchers';

interface TranslationResponse {
  translations: [
    {
      text: string;
      to: string;
    },
  ];
}

interface SupportedLanguagesResponse {
  translation: {
    [code: string]: {
      name: string;
      nativeName: string;
      direction: 'ltr' | 'rtl';
    };
  };
}

const LANGUAGE_ENDPOINT =
  'https://api.cognitive.microsofttranslator.com/languages?api-version=3.0';
const TRANSLATE_ENDPOINT =
  'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0';

export class AzureTranslator implements TranslationService {
  public name = 'Azure';
  private apiKey: string;
  private region?: string;
  private interpolationMatcher: Matcher;
  private supportedLanguages: Set<string>;
  private decodeEscapes: boolean;

  async initialize(
    config?: string,
    interpolationMatcher?: Matcher,
    decodeEscapes?: boolean,
  ) {
    const [apiKey, region] = config.split(',');
    if (!apiKey) throw new Error(`Please provide an API key for Azure.`);

    this.apiKey = apiKey;
    this.region = region;
    this.interpolationMatcher = interpolationMatcher;
    this.supportedLanguages = await this.getAvailableLanguages();
    this.decodeEscapes = decodeEscapes;
  }

  async getAvailableLanguages() {
    const response = await fetch(LANGUAGE_ENDPOINT);
    const supported = (await response.json()) as SupportedLanguagesResponse;
    const keys = Object.keys(supported.translation).map((k) => k.toLowerCase());

    // Some language codes can be simplified by using only the part before the dash
    const simplified = keys
      .filter((k) => k.includes('-'))
      .map((l) => l.split('-')[0]);

    return new Set(keys.concat(simplified));
  }

  supportsLanguage(language: string) {
    return this.supportedLanguages.has(language.toLowerCase());
  }

  async translateBatch(batch: TString[], from: string, to: string) {
    const toTranslate = batch.map(({ key, value }) => {
      const { clean, replacements } = replaceInterpolations(
        value,
        this.interpolationMatcher,
      );

      return { key, value, clean, replacements };
    });

    const headers = {
      'Ocp-Apim-Subscription-Key': this.apiKey,
      'Content-Type': 'application/json; charset=UTF-8',
    };

    if (this.region) {
      headers['Ocp-Apim-Subscription-Region'] = this.region;
    }

    const response = await fetch(
      `${TRANSLATE_ENDPOINT}&from=${from}&to=${to}&textType=html`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(toTranslate.map((c) => ({ Text: c.clean }))),
      },
    );

    if (!response.ok) {
      throw new Error('Azure Translation failed: ' + (await response.text()));
    }

    const data = (await response.json()) as TranslationResponse[];

    return data.map((res, i) => {
      const translated = reInsertInterpolations(
        res.translations[0].text,
        toTranslate[i].replacements,
      );
      return {
        key: toTranslate[i].key,
        value: toTranslate[i].value,
        translated: this.decodeEscapes ? decode(translated) : translated,
      };
    });
  }

  async translateStrings(
    strings: TString[],
    from: string,
    to: string,
  ): Promise<TranslationResult[]> {
    const batches = chunk(strings, 50);

    const results = await Promise.all(
      batches.map((batch) => this.translateBatch(batch, from, to)),
    );

    return flatten(results);
  }
}
