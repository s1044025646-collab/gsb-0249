export interface ResourceLimits {
  maxConditions: number;
  maxDecimalDigits: number;
  maxLcmBits: number;
  maxEnumerationPeriod: bigint;
  maxCandidates: number;
}

export const defaultLimits: ResourceLimits = {
  maxConditions: 100,
  maxDecimalDigits: 180,
  maxLcmBits: 4096,
  maxEnumerationPeriod: 100000n,
  maxCandidates: 1000,
};
