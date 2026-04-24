import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface WikiSection {
  title: string;
  content: string;
}

export interface WikiArticle {
  id: number;
  title: string;
  url: string;
  introduction: string;
  sections: WikiSection[];
}

@Injectable()
export class WikipediaService {
  private readonly logger = new Logger(WikipediaService.name);
  private readonly baseUrl = 'https://en.wikipedia.org/w/api.php';
  private readonly userAgent: string;
  private readonly minLength: number;

  constructor(private readonly config: ConfigService) {
    this.userAgent = this.config.get('WIKI_USER_AGENT', 'RAG-Project/1.0');
    this.minLength = this.config.get('CORPUS_MIN_TEXT_LENGTH', 1000);
  }

  async fetchArticle(title: string): Promise<WikiArticle | null> {
    try {
      // We fetch the full text already converted to plain text by Wikipedia (explaintext)
      // This avoids dealing with complex wikitext/templates.
      const { data } = await axios.get(this.baseUrl, {
        headers: { 'User-Agent': this.userAgent },
        params: {
          action: 'query',
          titles: title,
          prop: 'extracts|info',
          explaintext: true, // Crucial: returns plain text
          exlimit: 1,
          inprop: 'url',
          format: 'json',
          origin: '*',
        },
      });

      const page = Object.values(data.query.pages as Record<string, any>)[0] as any;

      if (!page || page.pageid === -1) {
        this.logger.warn(`Not found: "${title}"`);
        return null;
      }

      const fullText: string = page.extract ?? '';

      if (fullText.length < this.minLength) {
        this.logger.warn(`Skipping stub: "${title}"`);
        return null;
      }

      // Split the full text into sections
      const sections = this.parsePlainSections(fullText);

      const introduction = sections.length > 0 && sections[0].title === 'Introduction' 
        ? sections[0].content 
        : '';

      const filteredSections = sections.filter(s => s.title !== 'Introduction');

      return {
        id: page.pageid,
        title: page.title,
        url: page.fullurl,
        introduction: introduction,
        sections: filteredSections,
      };
    } catch (err) {
      this.logger.error(`Failed "${title}": ${err.message}`);
      return null;
    }
  }

  async search(query: string, limit: number): Promise<string[]> {
    try {
      const { data } = await axios.get(this.baseUrl, {
        headers: { 'User-Agent': this.userAgent },
        params: { action: 'query', list: 'search', srsearch: query, srlimit: limit, format: 'json', origin: '*' },
      });
      return data.query.search.map((r: any) => r.title);
    } catch {
      return [];
    }
  }

  // Parses the plain text from Wikipedia into sections.
   
   
  private parsePlainSections(text: string): WikiSection[] {
    const USELESS_SECTIONS = ['See also', 'Notes', 'Sources', 'Further reading', 'External links', 'Cited sources', 'References','Bibliography'];
    
    // Regex to find any heading level 2 (== Title ==)
    const sectionRegex = /^== ([^=]+) ==$/gm;
    
    const sections: WikiSection[] = [];
    let lastIndex = 0;
    let currentTitle = 'Introduction';
    let match;

    while ((match = sectionRegex.exec(text)) !== null) {
      // Extract content from the end of the last section to the start of this one
      const content = text.substring(lastIndex, match.index).trim();
      
      if (content && !USELESS_SECTIONS.includes(currentTitle)) {
        sections.push({
          title: currentTitle,
          content: this.cleanText(content),
        });
      }

      currentTitle = match[1].trim();
      lastIndex = match.index + match[0].length;
    }

    // Add the last section
    const lastContent = text.substring(lastIndex).trim();
    if (lastContent && !USELESS_SECTIONS.includes(currentTitle)) {
      sections.push({
        title: currentTitle,
        content: this.cleanText(lastContent),
      });
    }

    return sections;
  }

  private cleanText(text: string): string {
    return text
      // Remove subsection markers (=== Title ===) but keep the title text
      .replace(/^={3,6} ([^=]+) ={3,6}$/gm, '$1')
      // Remove multiple newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
