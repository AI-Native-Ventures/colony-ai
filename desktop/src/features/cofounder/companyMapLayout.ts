import { FUNCTION_DETAILS, FUNCTION_ORDER } from "./functions";
import type { FunctionId } from "./cofounderRecords";

export const COMPANY_MAP_SIZE = { width: 1400, height: 790 } as const;
export const COMPANY_MAP_CENTER = { x: 700, y: 395 } as const;

export type CompanyMapPoint = { x: number; y: number };
export type CompanyMapSide = -1 | 1;
export type CompanyMapJobPosition = {
  functionId: FunctionId;
  name: string;
  side: CompanyMapSide;
  point: CompanyMapPoint;
};
export type CompanyMapPartPosition = {
  functionId: FunctionId;
  side: CompanyMapSide;
  point: CompanyMapPoint;
};
export type CompanyMapLayout = {
  parts: CompanyMapPartPosition[];
  jobs: CompanyMapJobPosition[];
};

const PART_SIDE: Record<FunctionId, CompanyMapSide> = {
  sales: 1,
  finance: 1,
  operations: -1,
  customer_success: -1,
  brand: -1,
};

/** Returns the fixed side of a company function on the approved map layout. */
export function companyMapPartSide(functionId: FunctionId): CompanyMapSide {
  return PART_SIDE[functionId];
}

/** Match the measured arm and job coordinates in the approved company board. */
export function buildCompanyMapLayout(): CompanyMapLayout {
  const parts: CompanyMapPartPosition[] = [];
  const jobs: CompanyMapJobPosition[] = [];

  for (const side of [1, -1] as const) {
    const group = FUNCTION_ORDER.filter(
      (functionId) => companyMapPartSide(functionId) === side,
    );
    const pitch = side === 1 ? 54 : 48;
    const gap = side === 1 ? 26 : 20;
    const jobCount = group.reduce(
      (total, functionId) =>
        total + FUNCTION_DETAILS[functionId].subFunctions.length,
      0,
    );
    const totalHeight = jobCount * pitch + (group.length - 1) * gap;
    let y = (COMPANY_MAP_SIZE.height - totalHeight) / 2 - 8;

    for (const functionId of group) {
      const subFunctions = FUNCTION_DETAILS[functionId].subFunctions;
      const firstJobY = y + pitch / 2;

      for (const name of subFunctions) {
        jobs.push({
          functionId,
          name,
          side,
          point: {
            x: COMPANY_MAP_CENTER.x + side * 480,
            y: Math.round(y + pitch / 2),
          },
        });
        y += pitch;
      }

      const lastJobY = y - pitch / 2;
      parts.push({
        functionId,
        side,
        point: {
          x: COMPANY_MAP_CENTER.x + side * 280,
          y: Math.round((firstJobY + lastJobY) / 2),
        },
      });
      y += gap;
    }
  }

  return {
    parts: FUNCTION_ORDER.map((functionId) => {
      const part = parts.find(
        (candidate) => candidate.functionId === functionId,
      );
      if (!part)
        throw new Error(`Missing company map position for ${functionId}.`);
      return part;
    }),
    jobs: FUNCTION_ORDER.flatMap((functionId) =>
      jobs.filter((job) => job.functionId === functionId),
    ),
  };
}

export const COMPANY_MAP_LAYOUT = buildCompanyMapLayout();

export function companyMapPartPosition(
  functionId: FunctionId,
): CompanyMapPoint {
  return (
    COMPANY_MAP_LAYOUT.parts.find((part) => part.functionId === functionId)
      ?.point ?? COMPANY_MAP_CENTER
  );
}

export function companyMapJobPosition(
  functionId: FunctionId,
  name: string,
): CompanyMapPoint {
  return (
    COMPANY_MAP_LAYOUT.jobs.find(
      (job) => job.functionId === functionId && job.name === name,
    )?.point ?? COMPANY_MAP_CENTER
  );
}

export function mapPercent(value: number, extent: number): string {
  return `${(value / extent) * 100}%`;
}
