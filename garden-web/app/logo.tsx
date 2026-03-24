export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Wand/stem — a slightly curved plant stem running diagonally */}
      <path
        d="M20 58 C22 50, 28 38, 32 28 C34 22, 35 16, 34 10"
        stroke="#2d6a4f"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      {/* Second stem line for thickness/depth */}
      <path
        d="M21 57 C23 49, 29 37, 33 27 C35 21, 36 15, 35 9"
        stroke="#40916c"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />

      {/* Left leaf */}
      <path
        d="M28 36 C22 34, 16 30, 14 24 C18 26, 24 30, 28 34"
        fill="#40916c"
        stroke="#2d6a4f"
        strokeWidth="0.8"
      />
      {/* Left leaf vein */}
      <path
        d="M27 35 C23 32, 18 28, 16 25"
        stroke="#2d6a4f"
        strokeWidth="0.5"
        fill="none"
        opacity="0.6"
      />

      {/* Right leaf */}
      <path
        d="M33 30 C38 26, 44 24, 48 22 C44 28, 38 30, 33 31"
        fill="#52b788"
        stroke="#2d6a4f"
        strokeWidth="0.8"
      />
      {/* Right leaf vein */}
      <path
        d="M34 30 C38 27, 42 25, 46 23"
        stroke="#2d6a4f"
        strokeWidth="0.5"
        fill="none"
        opacity="0.6"
      />

      {/* Small leaf bud near top */}
      <path
        d="M34 16 C37 13, 40 12, 42 11 C40 15, 37 16, 34 17"
        fill="#52b788"
        stroke="#2d6a4f"
        strokeWidth="0.6"
      />

      {/* Star/sparkle at wand tip */}
      <g transform="translate(33, 6)">
        {/* Main 4-point star */}
        <path
          d="M0 -6 L1.2 -1.8 L6 0 L1.2 1.8 L0 6 L-1.2 1.8 L-6 0 L-1.2 -1.8 Z"
          fill="#d4a574"
          stroke="#c9956b"
          strokeWidth="0.4"
        />
        {/* Inner glow */}
        <circle cx="0" cy="0" r="1.8" fill="#d4a574" opacity="0.6" />
      </g>

      {/* Small sparkle accent — upper left */}
      <g transform="translate(24, 4)">
        <path
          d="M0 -2.5 L0.6 -0.8 L2.5 0 L0.6 0.8 L0 2.5 L-0.6 0.8 L-2.5 0 L-0.6 -0.8 Z"
          fill="#d4a574"
          opacity="0.7"
        />
      </g>

      {/* Small sparkle accent — right */}
      <g transform="translate(42, 8)">
        <path
          d="M0 -2 L0.5 -0.6 L2 0 L0.5 0.6 L0 2 L-0.5 0.6 L-2 0 L-0.5 -0.6 Z"
          fill="#d4a574"
          opacity="0.5"
        />
      </g>

      {/* Tiny sparkle dot */}
      <circle cx="28" cy="10" r="0.8" fill="#d4a574" opacity="0.4" />

      {/* Root/base flourish */}
      <path
        d="M18 58 C19 54, 20 56, 22 58"
        stroke="#40916c"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
    </svg>
  );
}
