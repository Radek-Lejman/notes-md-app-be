export enum SortDir {
  ASC = 'asc',
  DESC = 'desc',
}

export type SortInput<F extends string> = F | `-${F}`;

export type SortFieldOf<S extends string> = S extends `-${infer F extends string}` ? F : S;
