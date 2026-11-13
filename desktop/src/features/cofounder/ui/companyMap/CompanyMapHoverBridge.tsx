import type { FunctionId } from "@/features/cofounder/cofounderRecords";
import {
  companyMapJobPosition,
  companyMapPartPosition,
  COMPANY_MAP_LAYOUT,
} from "@/features/cofounder/companyMapLayout";
import { FUNCTION_DETAILS } from "@/features/cofounder/functions";

export function CompanyMapHoverBridge({
  functionId,
  onEnter,
  onLeave,
  onClick,
}: {
  functionId: FunctionId;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const part = companyMapPartPosition(functionId);
  const partSide =
    COMPANY_MAP_LAYOUT.parts.find(
      (position) => position.functionId === functionId,
    )?.side ?? 1;
  const positions = FUNCTION_DETAILS[functionId].subFunctions.map((name) =>
    companyMapJobPosition(functionId, name),
  );
  const firstY = positions[0]?.y ?? part.y;
  const lastY = positions[positions.length - 1]?.y ?? part.y;
  const left = partSide === 1 ? part.x + 44 : (positions[0]?.x ?? part.x) + 24;

  return (
    <span
      aria-hidden="true"
      className="company-map-hover-bridge"
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        left,
        top: firstY - 24,
        width: 132,
        height: lastY - firstY + 48,
      }}
    />
  );
}
