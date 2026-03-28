import { rem } from "@mantine/core";

interface Props {
  size?: number | string;
}

function IconPlantUml({ size }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ width: rem(size ?? 18), height: rem(size ?? 18) }}
    >
      <path d="M3 3h18v2H3V3zm0 4h12v2H3V7zm0 4h18v2H3v-2zm0 4h12v2H3v-2zm0 4h18v2H3v-2z" />
    </svg>
  );
}

export default IconPlantUml;
