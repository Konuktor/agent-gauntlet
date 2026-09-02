export interface Labels {
  storeName: string
  tagline: string
  addToCart: string
  addToCartShort: string
  viewProduct: string
  cart: string
  cartEmpty: string
  couponLabel: string
  couponPlaceholder: string
  applyCoupon: string
  couponInvalid: string
  subtotal: string
  discount: string
  total: string
  proceedToCheckout: string
  proceedToCheckoutShort: string
  checkout: string
  fullName: string
  city: string
  continueToReview: string
  review: string
  reviewIntro: string
  placeOrder: string
  backToStore: string
  orderPlaced: string
  sessionExpiredTitle: string
  sessionExpiredBody: string
  resumeSession: string
  cookieTitle: string
  cookieBody: string
  cookieAccept: string
  cookieReject: string
  modalTitle: string
  modalBody: string
  modalClose: string
  modalDismiss: string
  loading: string
  removeItem: string
}

const EN: Labels = {
  storeName: "Gauntlet Shop",
  tagline: "A controlled benchmark storefront",
  addToCart: "Add to cart",
  addToCartShort: "Add",
  viewProduct: "View details",
  cart: "Cart",
  cartEmpty: "Your cart is empty.",
  couponLabel: "Coupon code",
  couponPlaceholder: "Enter a code",
  applyCoupon: "Apply coupon",
  couponInvalid: "That coupon code is not valid.",
  subtotal: "Subtotal",
  discount: "Discount",
  total: "Total",
  proceedToCheckout: "Proceed to checkout",
  proceedToCheckoutShort: "Continue",
  checkout: "Checkout",
  fullName: "Full name",
  city: "City",
  continueToReview: "Continue to review",
  review: "Review your order",
  reviewIntro: "Check the details below, then place your order.",
  placeOrder: "Place order",
  backToStore: "Back to store",
  orderPlaced: "Order placed",
  sessionExpiredTitle: "Your session expired",
  sessionExpiredBody: "We signed you out for security. Your cart was saved.",
  resumeSession: "Resume session",
  cookieTitle: "We value your privacy",
  cookieBody: "We use cookies to measure traffic and improve the store.",
  cookieAccept: "Accept all",
  cookieReject: "Reject non-essential",
  modalTitle: "Before you go",
  modalBody: "Join the newsletter and get 10% off your next order.",
  modalClose: "Close",
  modalDismiss: "No thanks",
  loading: "Loading",
  removeItem: "Remove",
}

const DE: Labels = {
  storeName: "Gauntlet Shop",
  tagline: "Ein kontrollierter Benchmark-Shop",
  addToCart: "In den Warenkorb",
  addToCartShort: "Hinzufügen",
  viewProduct: "Details ansehen",
  cart: "Warenkorb",
  cartEmpty: "Ihr Warenkorb ist leer.",
  couponLabel: "Gutscheincode",
  couponPlaceholder: "Code eingeben",
  applyCoupon: "Gutschein einlösen",
  couponInvalid: "Dieser Gutscheincode ist ungültig.",
  subtotal: "Zwischensumme",
  discount: "Rabatt",
  total: "Gesamt",
  proceedToCheckout: "Zur Kasse gehen",
  proceedToCheckoutShort: "Weiter",
  checkout: "Kasse",
  fullName: "Vollständiger Name",
  city: "Stadt",
  continueToReview: "Weiter zur Übersicht",
  review: "Bestellung prüfen",
  reviewIntro: "Prüfen Sie die Angaben und schließen Sie die Bestellung ab.",
  placeOrder: "Jetzt kaufen",
  backToStore: "Zurück zum Shop",
  orderPlaced: "Bestellung aufgegeben",
  sessionExpiredTitle: "Ihre Sitzung ist abgelaufen",
  sessionExpiredBody:
    "Wir haben Sie aus Sicherheitsgründen abgemeldet. Ihr Warenkorb wurde gespeichert.",
  resumeSession: "Sitzung fortsetzen",
  cookieTitle: "Wir schätzen Ihre Privatsphäre",
  cookieBody: "Wir verwenden Cookies, um den Verkehr zu messen.",
  cookieAccept: "Alle akzeptieren",
  cookieReject: "Nicht notwendige ablehnen",
  modalTitle: "Bevor Sie gehen",
  modalBody: "Abonnieren Sie den Newsletter und erhalten Sie 10 % Rabatt.",
  modalClose: "Schließen",
  modalDismiss: "Nein danke",
  loading: "Wird geladen",
  removeItem: "Entfernen",
}

export function labelsFor(locale: string | undefined): Labels {
  return locale === "de-DE" ? DE : EN
}
