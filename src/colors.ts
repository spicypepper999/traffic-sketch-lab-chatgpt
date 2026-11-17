/** Stable, perceptually separated colors for intersection movements and OD pairs. */
export const movementColor=(index:number):string=>`hsl(${((index*137.508+19)%360).toFixed(1)} 88% 70%)`;
export const pairColor=(index:number):string=>`hsl(${((index*137.508+192)%360).toFixed(1)} 66% 42%)`;
