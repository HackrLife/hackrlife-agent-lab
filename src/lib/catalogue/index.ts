import type { Product } from "./types";
import { appointmentAssistant } from "./products/appointment-assistant";
import { bookingFollowUp } from "./products/booking-follow-up";
import { businessAccounts } from "./products/business-accounts";
import { customerWinBack } from "./products/customer-win-back";
import { demandManager } from "./products/demand-manager";
import { eventSalesAssistant } from "./products/event-sales-assistant";
import { garageReceptionist } from "./products/garage-receptionist";
import { guestExtras } from "./products/guest-extras";
import { hotelConcierge } from "./products/hotel-concierge";
import { leadToSale } from "./products/lead-to-sale";
import { occasionReminders } from "./products/occasion-reminders";
import { orderAssistant } from "./products/order-assistant";
import { quoteFollowUp } from "./products/quote-follow-up";
import { rebookingManager } from "./products/rebooking-manager";
import { repairApprovals } from "./products/repair-approvals";
import { repairFollowUp } from "./products/repair-follow-up";
import { serviceReminders } from "./products/service-reminders";
import { voiceReceptionist } from "./products/voice-receptionist";
import { waitlistManager } from "./products/waitlist-manager";
import { websiteConcierge } from "./products/website-concierge";

/** Canonical catalogue order (brief, “The twenty product cards”). */
export const products: Product[] = [
  appointmentAssistant,
  bookingFollowUp,
  businessAccounts,
  customerWinBack,
  demandManager,
  eventSalesAssistant,
  garageReceptionist,
  guestExtras,
  hotelConcierge,
  leadToSale,
  occasionReminders,
  orderAssistant,
  quoteFollowUp,
  rebookingManager,
  repairApprovals,
  repairFollowUp,
  serviceReminders,
  voiceReceptionist,
  waitlistManager,
  websiteConcierge,
].sort((a, b) => a.no - b.no);

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export * from "./types";
