"use client";

import React from "react";
import { 
  Wind, Utensils, Waves, Dumbbell, Car, Shield, 
  Wifi, TreePine, Tv 
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const AMENITY_CATEGORIES = {
  utilities: {
    label: "Utilities & Comfort",
    icons: [
      { Icon: Wind, label: "Power/AC" },
      { Icon: Wifi, label: "Internet/Smart Home" },
    ]
  },
  facilities: {
    label: "Facilities",
    icons: [
      { Icon: Utensils, label: "Kitchen" },
      { Icon: Waves, label: "Pool" },
      { Icon: Dumbbell, label: "Gym/Spa" },
      { Icon: Tv, label: "Entertainment" },
    ]
  },
  outdoor: {
    label: "Outdoor & Parking",
    icons: [
      { Icon: TreePine, label: "Garden/Balcony" },
      { Icon: Car, label: "Parking/Garage" },
    ]
  },
  security: {
    label: "Security",
    icons: [
      { Icon: Shield, label: "Security Systems" },
    ]
  }
};

export function AmenitiesLegend() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">Amenities Guide</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(AMENITY_CATEGORIES).map(([key, category]) => (
            <div key={key} className="space-y-2">
              <h4 className="font-semibold text-sm text-muted-foreground">
                {category.label}
              </h4>
              <div className="space-y-1.5">
                {category.icons.map(({ Icon, label }) => (
                  <div 
                    key={label} 
                    className="flex items-center gap-2 text-sm"
                    role="listitem"
                    aria-label={`${label} amenity`}
                  >
                    <Icon 
                      className="h-4 w-4 flex-shrink-0 text-primary" 
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
