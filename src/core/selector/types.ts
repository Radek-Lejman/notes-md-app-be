export type FieldSelector<T> = {
  [K in keyof T]?: boolean;
};
