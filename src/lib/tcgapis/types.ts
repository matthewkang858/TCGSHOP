// Response shapes for TCGAPIs (https://api.tcgapis.com).
// IDs live in the TCGplayer keyspace: categoryId -> groupId -> productId -> skuId.

export type ListEnvelope<T> = {
  success: boolean;
  count: number;
  total: number;
  offset: number;
  limit: number;
  data: T[];
};

export type ApiError = { success: false; error: string };

export type ApiGame = {
  categoryId: number;
  name: string; // ASCII name used in URLs ("Pokemon")
  displayName?: string;
};

export type ApiExpansion = {
  groupId: number;
  categoryId?: number;
  name: string;
  abbreviation?: string | null;
  publishedOn?: string | null;
};

// From GET /api/v2/cards/:groupId - despite the name this is the *products*
// endpoint; sealed rows simply lack number/rarity.
export type ApiProduct = {
  productId: number;
  name: string;
  cleanName?: string | null;
  image?: string | null;
  imageUrl?: string | null;
  rarity?: string | null;
  number?: string | null;
  groupId?: number;
};

export type ApiProductPrices = {
  productId: number;
  prices: Array<{
    subTypeName?: string | null; // Normal | Foil | ...
    marketPrice?: number | null;
    lowPrice?: number | null;
    midPrice?: number | null;
    highPrice?: number | null;
    directLowPrice?: number | null;
  }>;
};

export type ApiSkuPrice = {
  skuId: number;
  productId: number;
  condition?: string | null;
  printing?: string | null;
  language?: string | null;
  lowPrice?: number | null;
  marketPrice?: number | null;
};

export type ApiSalesHistory = {
  productId: number;
  sales?: Array<{
    price: number;
    quantity: number;
    condition?: string | null;
    variant?: string | null;
    orderDate?: string | null;
  }>;
  statistics?: {
    last24Hours?: { count?: number; quantity?: number } | null;
  } | null;
  priceAnalysis?: {
    trend?: "up" | "down" | "stable" | string | null;
  } | null;
  variants?: Record<
    string,
    { avg?: number; median?: number; min?: number; max?: number; count?: number }
  >;
};

// GET /api/v2/sales-history/:productId/full - 3-day rolling buckets per SKU
export type ApiSalesBucket = {
  skuId?: number | null;
  condition?: string | null;
  variant?: string | null; // Normal | Foil
  language?: string | null;
  bucketStart: string;
  marketPrice?: number | null;
  quantitySold?: number | null;
  lowSalePrice?: number | null;
  highSalePrice?: number | null;
  transactionCount?: number | null;
};

export type TrendProvider =
  | "tcgplayer"
  | "cardkingdom"
  | "manapool"
  | "cardhoarder"
  | "cardmarket";
export type TrendListing = "retail" | "buylist";
export type TrendFinish = "normal" | "foil" | "etched";

export type ApiTrendPrice = {
  productId: number;
  provider: TrendProvider;
  listing: TrendListing;
  finish?: TrendFinish | null;
  price: number | null;
  currency?: string | null;
  date?: string | null;
};

// One row of the bulk catalog CSV (or its fixture equivalent), normalized.
export type CatalogRow = {
  categoryId: number;
  groupId: number;
  expansionName: string;
  expansionAbbreviation?: string | null;
  expansionPublishedOn?: string | null;
  productId: number;
  name: string;
  cleanName: string;
  number?: string | null;
  rarity?: string | null;
  imageUrl?: string | null;
};
