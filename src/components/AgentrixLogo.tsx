import React from "react";

interface AgentrixLogoProps {
  isDark?: boolean;
  size?: number;
  className?: string;
}

export const AgentrixLogo: React.FC<AgentrixLogoProps> = ({
  isDark = true,
  size = 24,
  className = "",
}) => {
  // 사용자의 명확한 요구사항:
  // - 다크 모드일 때: Agentrix_Matrix_Light.svg (밝은 배경 #F6F7F9 + 어두운 격자 #171A20)
  // - 라이트 모드일 때: Agentrix_Matrix_Dark.svg (어두운 배경 #191B21 + 밝은 격자 #F8FAFC)
  const bgColor = isDark ? "#F6F7F9" : "#191B21";
  const fgColor = isDark ? "#171A20" : "#F8FAFC";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      shapeRendering="geometricPrecision"
      style={{ imageRendering: "pixelated" }}
    >
      {/* 둥근 외곽 배경 */}
      <rect x="1" y="1" width="22" height="22" rx="5" fill={bgColor} />

      {/* 3x3 매트릭스 격자 (24px 환경에서 칼같이 선명하게 픽셀 정렬) */}
      {/* Row 1 */}
      <rect x="4.8" y="4.8" width="3.6" height="3.6" rx="0.75" stroke={fgColor} strokeWidth="1.2" />
      <rect x="10.2" y="4.8" width="3.6" height="3.6" rx="0.75" stroke={fgColor} strokeWidth="1.2" />
      <rect x="15.6" y="4.8" width="3.6" height="3.6" rx="0.75" stroke={fgColor} strokeWidth="1.2" />

      {/* Row 2 */}
      <rect x="4.8" y="10.2" width="3.6" height="3.6" rx="0.75" stroke={fgColor} strokeWidth="1.2" />
      {/* 중앙 채워진 코어 블록 */}
      <rect x="9.8" y="9.8" width="4.4" height="4.4" rx="0.9" fill={fgColor} />
      <rect x="15.6" y="10.2" width="3.6" height="3.6" rx="0.75" stroke={fgColor} strokeWidth="1.2" />

      {/* Row 3 */}
      <rect x="4.8" y="15.6" width="3.6" height="3.6" rx="0.75" stroke={fgColor} strokeWidth="1.2" />
      <rect x="10.2" y="15.6" width="3.6" height="3.6" rx="0.75" stroke={fgColor} strokeWidth="1.2" />
      <rect x="15.6" y="15.6" width="3.6" height="3.6" rx="0.75" stroke={fgColor} strokeWidth="1.2" />
    </svg>
  );
};
