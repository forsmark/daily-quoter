export type Quote = {
  text: string;
  author: string;
  attribution: string;
  sourceUrl?: string;
};

export type Background = {
  id: string;
  name: string;
  imageUrl: string;
  credit: string;
  creditUrl?: string;
};

export type FontChoice = {
  id: string;
  name: string;
  family: string;
  category: "blocky" | "serif" | "cursive" | "mono" | "display";
};

export type QuoteHistoryItem = {
  id: number;
  quote: string;
  author: string;
  attribution: string;
  backgroundId: string;
  backgroundName: string;
  backgroundImageUrl: string;
  backgroundCredit: string;
  backgroundCreditUrl: string;
  fontId: string;
  fontName: string;
  fontFamily: string;
  selectedOn: string;
};
