import { createRss2Source, RSS2_FEEDS } from "./feeds";

export interface CodeZineItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string;
}

export const searchCodeZine = createRss2Source<CodeZineItem>("codezine", RSS2_FEEDS.codezine, 50);
