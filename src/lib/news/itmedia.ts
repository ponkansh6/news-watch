import { createRss2Source, RSS2_FEEDS } from "./feeds";

export interface ItmediaItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  category?: string | string[];
}

export const searchITmedia = createRss2Source<ItmediaItem>("itmedia", RSS2_FEEDS.itmedia);
