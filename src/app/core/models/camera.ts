export const CameraOrientation = {
    front: 'user',
    back:  'environment'
} as const;

export type CameraOrientation = typeof CameraOrientation[keyof typeof CameraOrientation];
