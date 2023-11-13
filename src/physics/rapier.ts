export type Rapier = typeof import('@dimforge/rapier2d');

export function getRapier() {
  // eslint-disable-next-line import/no-named-as-default-member
  return import('@dimforge/rapier2d');
}
