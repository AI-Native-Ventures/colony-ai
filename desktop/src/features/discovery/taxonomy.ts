import industryData from "./data/industry-taxonomy.json";
import peopleData from "./data/people-taxonomy.json";

export type TaxonomyVertical = {
  id: string;
  label: string;
  description?: string;
};

export type IndustryCategory = {
  id: string;
  label: string;
  description?: string;
  verticals: TaxonomyVertical[];
};

export type PeopleField = {
  id: string;
  name: string;
  imageKey?: string;
  roles: string[];
};

export type CatalogueRow = {
  id: string;
  name: string;
  description: string;
  parentId: string;
  parentName: string;
};

export const industryTaxonomy = industryData as IndustryCategory[];
export const peopleTaxonomy = peopleData as PeopleField[];

export function countVerticals(): number {
  return industryTaxonomy.reduce(
    (count, category) => count + category.verticals.length,
    0,
  );
}

export function countPeopleRoles(): number {
  return peopleTaxonomy.reduce((count, field) => count + field.roles.length, 0);
}

export function searchCatalogue(
  mode: "businesses" | "people",
  query: string,
  industryId: string | null,
): CatalogueRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (mode === "businesses") {
    return industryTaxonomy.flatMap((category) => {
      if (industryId && category.id !== industryId) return [];
      return category.verticals
        .filter((vertical) => {
          if (!normalizedQuery) return true;
          return [vertical.label, category.label, vertical.description ?? ""]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery);
        })
        .map((vertical) => ({
          id: vertical.id,
          name: vertical.label,
          description: vertical.description ?? "",
          parentId: category.id,
          parentName: category.label,
        }));
    });
  }

  return peopleTaxonomy.flatMap((field) => {
    if (industryId && field.id !== industryId) return [];
    return field.roles
      .map((role) => ({
        id: role
          .toLocaleLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        name: role,
        description: "",
        parentId: field.id,
        parentName: field.name,
      }))
      .filter((role) => {
        if (!normalizedQuery) return true;
        return `${role.name} ${field.name}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      });
  });
}
