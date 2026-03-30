// Re-export all mock data from this file for easy imports

// Homepage
export { homePageStats, homePageBenefits } from "./homepage";

// Properties
export { allProperties, propertyFilters } from "./properties";

// Messages
export { conversations, messageThreads } from "./messagesData";

// Landlords Page
export {
  landlordBenefits,
  landlordStats,
  landlordTestimonials,
} from "./landlordsPage";

// Lease
export { leaseDetails } from "./leaseData";

// Documents
export {
  leaseAgreement,
  propertyInspectionReport,
  paymentSchedule,
  houseRules,
} from "./documents";

// Tenant dashboard & payments
export {
  tenantWalletData,
  tenantPaymentSchedule,
  tenantPastPayments,
  tenantCurrentLease,
  tenantDashboardPaymentSchedule,
  tenantDashboardPastPayments,
  tenantSavedProperties,
  tenantApplicationProperties,
  tenantWhistleblowersToRate,
} from "./tenant";

// User dashboard
export {
  userSavedProperties,
  userRentalApplications,
  userWalletBalance,
  userWalletLedger,
} from "./userDashboard";

// Landlord dashboard
export {
  landlordMyProperties,
  landlordDashboardStats,
  landlordProperties,
  landlordTenants,
  landlordPaymentHistory,
} from "./landlord";

// Whistleblower
export {
  whistleblowerData,
  whistleblowerListings,
  whistleblowerEarnings,
} from "./whistleblower";

// Admin
export { whistleblowerApplications } from "./admin";
