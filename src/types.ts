export interface ConstraintInput {
  modulus: string;
  remainder: string;
  label?: string;
}

export interface NormalizedConstraint {
  index: number;
  label?: string;
  modulus: string;
  remainder: string;
  originalRemainder: string;
}

export interface MergeStep {
  step: number;
  before: { remainder: string; modulus: string };
  incoming: NormalizedConstraint;
  gcd: string;
  difference: string;
  dividesDifference: boolean;
  differenceQuotient?: string;
  lcm?: string;
  after?: { remainder: string; modulus: string };
  check: string;
}

export interface ConflictExplanation {
  conflict: true;
  step: number;
  existing: { remainder: string; modulus: string };
  incoming: NormalizedConstraint;
  gcd: string;
  difference: string;
  check: string;
}

export interface SolveResult {
  solvable: boolean;
  solution: { remainder: string; modulus: string };
  normalizedConstraints: NormalizedConstraint[];
  steps: MergeStep[];
  conflict: null | ConflictExplanation;
}

export interface VerificationItem {
  index: number;
  label?: string;
  candidate: string;
  modulus: string;
  expectedRemainder: string;
  actualRemainder: string;
  satisfied: boolean;
}

export interface RangeResult {
  lower: string;
  upper: string;
  count: string;
  first: string | null;
  last: string | null;
}
