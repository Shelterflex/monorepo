import { describe, it, expect } from "vitest";
import {
  NIGERIAN_CITIES,
  PROPERTY_AMENITIES,
  PROPERTY_AMENITY_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
} from "../amenities";

describe("property amenities", () => {
  it("has a human label for every amenity and no extra labels", () => {
    expect(Object.keys(PROPERTY_AMENITY_LABELS).sort()).toEqual([...PROPERTY_AMENITIES].sort());
  });

  it("gives every amenity a non-empty, unique label", () => {
    const labels = PROPERTY_AMENITIES.map((a) => PROPERTY_AMENITY_LABELS[a]);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("uses unique snake_case identifiers", () => {
    expect(new Set(PROPERTY_AMENITIES).size).toBe(PROPERTY_AMENITIES.length);
    for (const amenity of PROPERTY_AMENITIES) {
      expect(amenity).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

describe("property types", () => {
  it("has a label for every property type", () => {
    expect(Object.keys(PROPERTY_TYPE_LABELS).sort()).toEqual([...PROPERTY_TYPES].sort());
    expect(PROPERTY_TYPES.map((t) => PROPERTY_TYPE_LABELS[t])).toEqual([
      "Flat",
      "Duplex",
      "Studio",
      "Room",
    ]);
  });
});

describe("NIGERIAN_CITIES", () => {
  it("lists the supported cities without duplicates", () => {
    expect(NIGERIAN_CITIES).toContain("Lagos");
    expect(new Set(NIGERIAN_CITIES).size).toBe(NIGERIAN_CITIES.length);
  });
});
