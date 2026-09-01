export interface Product {
  sku: string
  name: string
  tagline: string
  priceCents: number
  rating: number
  hue: number
}

/** Small, fixed catalogue. The task always targets aurora-headphones; the rest
 *  exist so "find the right product" is a real step and not a single link. */
export const CATALOG: readonly Product[] = [
  {
    sku: "nimbus-keyboard",
    name: "Nimbus Keyboard",
    tagline: "Low-profile mechanical, hot-swappable",
    priceCents: 14900,
    rating: 4.4,
    hue: 210,
  },
  {
    sku: "aurora-headphones",
    name: "Aurora Headphones",
    tagline: "Over-ear, active noise cancelling",
    priceCents: 9900,
    rating: 4.7,
    hue: 265,
  },
  {
    sku: "lumen-desk-lamp",
    name: "Lumen Desk Lamp",
    tagline: "Tuneable white, USB-C powered",
    priceCents: 6400,
    rating: 4.2,
    hue: 40,
  },
  {
    sku: "atlas-backpack",
    name: "Atlas Backpack",
    tagline: "22L, weather-sealed zips",
    priceCents: 12000,
    rating: 4.5,
    hue: 150,
  },
]

export const COUPONS: Record<string, { percentOff: number }> = {
  SAVE20: { percentOff: 20 },
}

export function findProduct(sku: string): Product | undefined {
  return CATALOG.find((p) => p.sku === sku)
}

export function formatPrice(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale === "de-DE" ? "de-DE" : "en-US", {
    style: "currency",
    currency: locale === "de-DE" ? "EUR" : "USD",
  }).format(cents / 100)
}
