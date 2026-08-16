import { createRss2Source, RSS2_FEEDS } from "./feeds";

export interface YamadashyItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
  guid?: string;
  category?: string | string[];
}

export const searchYamadashy = createRss2Source<YamadashyItem>("yamadashy", RSS2_FEEDS.yamadashy);
