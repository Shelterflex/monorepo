export const leaseAgreement = {
  id: 1,
  title: "Lease Agreement",
  date: "Jan 1, 2025",
  type: "PDF",
  size: "2.4 MB",
  status: "signed",
  content: {
    sections: [
      {
        title: "1. PARTIES TO THE LEASE",
        content:
          "This Lease Agreement is entered into on the 1st day of January, 2025, BETWEEN Chief Emeka Okonkwo (hereinafter called 'the Landlord') AND Ngozi Adekunle (hereinafter called 'the Tenant'). The Landlord owns the property located at 15 Admiralty Way, Lekki Phase 1, Lagos, Nigeria.",
      },
      {
        title: "2. PROPERTY DESCRIPTION",
        content:
          "The property is a modern 3-bedroom, 2-bathroom apartment spanning 120 square meters. It includes furnished living spaces, kitchen facilities, and standard amenities. The property is rented as-is with all fixtures and fittings currently present.",
      },
      {
        title: "3. LEASE TERM",
        content:
          "The lease commences on 1st January 2025 and terminates on 31st December 2025 (12 months). This is a fixed-term lease, and renewal is subject to mutual agreement.",
      },
      {
        title: "4. RENT PAYMENT",
        content:
          "The annual rent is ₦2,580,000 (Two Million, Five Hundred Eighty Thousand Naira). Monthly payment through Shelterflex is ₦215,000 due on the 1st of each month. Payment is non-refundable once processed.",
      },
      {
        title: "5. SECURITY DEPOSIT",
        content:
          "A security deposit of ₦516,000 (20% of annual rent) has been paid. This deposit is non-refundable and serves as Shelterflex's security measure. It is renewed annually to demonstrate tenant commitment.",
      },
      {
        title: "6. TENANT OBLIGATIONS",
        content:
          "The tenant agrees to: keep the property in good condition, maintain cleanliness, report repairs promptly, comply with house rules, not sublet without written consent, and pay utilities on time.",
      },
      {
        title: "7. LANDLORD OBLIGATIONS",
        content:
          "The landlord agrees to: maintain the property in habitable condition, make necessary repairs within 48 hours of notification, ensure utilities are functional, and respect tenant privacy.",
      },
      {
        title: "8. TERMINATION",
        content:
          "Either party may terminate with 30 days written notice. Early termination by tenant may result in forfeit of deposit. Landlord termination requires valid grounds per Nigerian rental laws.",
      },
    ],
  },
};

export const propertyInspectionReport = {
  id: 2,
  title: "Property Inspection Report",
  date: "Dec 28, 2024",
  type: "PDF",
  size: "1.8 MB",
  status: "completed",
  content: {
    sections: [
      {
        title: "INSPECTION OVERVIEW",
        content:
          "Property Inspection conducted on 28th December 2024. This report documents the condition of the property at lease commencement.",
      },
      {
        title: "EXTERIOR CONDITION",
        items: [
          "Building façade: Excellent condition, recently painted",
          "Entrance gates: Functional with security locks",
          "Parking spaces: 2 allocated spaces, well-maintained",
          "Common areas: Clean, good lighting installed",
        ],
      },
      {
        title: "INTERIOR - LIVING AREAS",
        items: [
          "Living room: 25m², well-lit with natural light, 2 AC units working",
          "Flooring: Polished tiles in good condition, no cracks observed",
          "Walls: Freshly painted, no moisture stains or mold detected",
          "Lighting: All fixtures functional and bright",
        ],
      },
      {
        title: "KITCHEN",
        items: [
          "Size: 12m² modern kitchen layout",
          "Appliances: Gas cooker, refrigerator, and water dispenser provided",
          "Cabinets: Built-in storage with excellent organization",
          "Water supply: Functional with good pressure",
        ],
      },
      {
        title: "BEDROOMS",
        items: [
          "Master bedroom: 20m², excellent natural light, ceiling fan installed",
          "Second bedroom: 18m², suitable for guests or office space",
          "Third bedroom: 15m², same standards as other bedrooms",
          "All bedrooms: No signs of dampness, proper ventilation",
        ],
      },
      {
        title: "BATHROOMS",
        items: [
          "Master bathroom: Fitted with shower, bathtub, and toilet",
          "Guest bathroom: Modern fixtures, good drainage",
          "Water heating: Functional gas heater installed",
          "Ventilation: Extract fans working properly",
        ],
      },
      {
        title: "UTILITIES & SAFETY",
        items: [
          "Electricity: Main switch functional, adequate outlets",
          "Water: Tank capacity 5000L with backup generator",
          "Security: Burglar-proof windows, sturdy doors with locks",
          "Fire safety: No fire extinguishers present - recommend adding",
        ],
      },
      {
        title: "OVERALL ASSESSMENT",
        content:
          "Property is in excellent condition, suitable for immediate occupancy. All major systems are functional. Minor recommendation: Install fire safety equipment. Overall rating: 9.2/10",
      },
    ],
  },
};

export const paymentSchedule = {
  id: 3,
  title: "Payment Schedule",
  date: "Jan 1, 2025",
  type: "PDF",
  size: "0.8 MB",
  status: "active",
  content: {
    sections: [
      {
        title: "PAYMENT STRUCTURE",
        content:
          "Annual rent: ₦2,580,000 | Monthly payment: ₦215,000 | Duration: 12 months | Payment method: Shelterflex platform",
      },
      {
        title: "PAYMENT SCHEDULE TABLE",
        items: [
          "Month 1 (Jan 2025): ₦215,000 - Due: Jan 1, 2025",
          "Month 2 (Feb 2025): ₦215,000 - Due: Feb 1, 2025",
          "Month 3 (Mar 2025): ₦215,000 - Due: Mar 1, 2025",
          "Month 4 (Apr 2025): ₦215,000 - Due: Apr 1, 2025",
          "Month 5 (May 2025): ₦215,000 - Due: May 1, 2025",
          "Month 6 (Jun 2025): ₦215,000 - Due: Jun 1, 2025",
          "Month 7 (Jul 2025): ₦215,000 - Due: Jul 1, 2025",
          "Month 8 (Aug 2025): ₦215,000 - Due: Aug 1, 2025",
          "Month 9 (Sep 2025): ₦215,000 - Due: Sep 1, 2025",
          "Month 10 (Oct 2025): ₦215,000 - Due: Oct 1, 2025",
          "Month 11 (Nov 2025): ₦215,000 - Due: Nov 1, 2025",
          "Month 12 (Dec 2025): ₦215,000 - Due: Dec 1, 2025",
        ],
      },
      {
        title: "PAYMENT TERMS",
        items: [
          "Initial deposit: ₦516,000 (20% of annual rent) - Paid",
          "Payment method: Shelterflex platform or wallet top-up",
          "Late payment: 5% penalty per week after due date",
          "Early settlement: Possible with no extra charges",
          "Wallet balance: Checked first before auto-deduction",
        ],
      },
      {
        title: "ADDITIONAL COSTS (Not included in rent)",
        items: [
          "Inspection fee: ₦5,000 - ₦25,000 (property verification)",
          "Agreement fee: ₦10,000 (if applicable)",
          "Utilities: Electricity and water bills payable separately",
        ],
      },
    ],
  },
};

export const houseRules = {
  id: 4,
  title: "House Rules",
  date: "Jan 1, 2025",
  type: "PDF",
  size: "1.2 MB",
  status: "acknowledged",
  content: {
    sections: [
      {
        title: "1. OCCUPANCY RULES",
        items: [
          "Only registered tenant and immediate family members are permitted to reside in the property",
          "Maximum 6 people as per lease agreement",
          "Visitors must be registered and may stay maximum 14 consecutive days",
          "No subletting or room renting without landlord written approval",
        ],
      },
      {
        title: "2. NOISE & DISTURBANCE",
        items: [
          "Quiet hours: 10 PM - 7 AM on weekdays, 11 PM - 8 AM on weekends",
          "Music and entertainment must be at reasonable volumes",
          "Heavy machinery or construction not permitted without prior notice",
          "Disturbing neighbors repeatedly may result in lease termination",
        ],
      },
      {
        title: "3. MAINTENANCE & CLEANLINESS",
        items: [
          "Tenant is responsible for general cleaning and maintenance",
          "Common areas must be kept clean at all times",
          "Pest control: Report any infestation within 24 hours",
          "Repairs: Report maintenance issues within 48 hours of discovery",
        ],
      },
      {
        title: "4. UTILITIES & BILLS",
        items: [
          "Electricity and water bills are tenant's responsibility",
          "Generator use: Only for emergency purposes",
          "Ensure timely payment of all utility bills",
          "Report any leaks or utility issues immediately",
        ],
      },
      {
        title: "5. SECURITY",
        items: [
          "Keep all doors and windows locked when away",
          "Do not share security codes with unauthorized persons",
          "Report any security breaches immediately",
          "Parking only in assigned spaces",
        ],
      },
      {
        title: "6. PROHIBITED ACTIVITIES",
        items: [
          "No illegal activities of any kind",
          "No commercial business operations from the property",
          "No gambling, drug use, or alcohol abuse",
          "No animal pets without written landlord approval",
        ],
      },
      {
        title: "7. PROPERTY DAMAGE",
        items: [
          "Tenant is liable for damages beyond normal wear and tear",
          "Report accidental damage immediately to landlord",
          "Large repairs must be approved before proceeding",
        ],
      },
      {
        title: "8. INSPECTIONS",
        items: [
          "Landlord may inspect property with 48 hours notice",
          "Emergency inspections allowed without notice if necessary",
          "Quarterly maintenance checks are scheduled",
        ],
      },
    ],
  },
};
