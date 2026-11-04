import serviceFabric from './textures/fabric-services.webp';
import networkFabric from './textures/fabric-networks.webp';
import volumeFabric from './textures/fabric-volumes.webp';
import secretFabric from './textures/fabric-secrets.webp';
import configFabric from './textures/fabric-configs.webp';
import modelFabric from './textures/fabric-models.webp';
import jobFabric from './textures/fabric-jobs.webp';
import serviceRope from './textures/rope-services.webp';
import networkRope from './textures/rope-networks.webp';
import volumeRope from './textures/rope-volumes.webp';
import secretRope from './textures/rope-secrets.webp';
import configRope from './textures/rope-configs.webp';
import modelRope from './textures/rope-models.webp';
import jobRope from './textures/rope-jobs.webp';

export type Material = {
  fabric: string;
  rope: string;
  name: string;
  accent: string;
  opacity: number;
};
export const materials: Record<string, Material> = {
  services: {
    fabric: serviceFabric,
    rope: serviceRope,
    name: 'Denim · cotton',
    accent: '#8da7c8',
    opacity: 0.36,
  },
  networks: {
    fabric: networkFabric,
    rope: networkRope,
    name: 'Canvas · braided cotton',
    accent: '#9bb8a1',
    opacity: 0.36,
  },
  volumes: {
    fabric: volumeFabric,
    rope: volumeRope,
    name: 'Burlap · jute',
    accent: '#cbb08a',
    opacity: 0.31,
  },
  secrets: {
    fabric: secretFabric,
    rope: secretRope,
    name: 'Velvet · silk cotton',
    accent: '#be98ab',
    opacity: 0.4,
  },
  configs: {
    fabric: configFabric,
    rope: configRope,
    name: 'Linen · cotton',
    accent: '#cbc5b6',
    opacity: 0.25,
  },
  models: {
    fabric: modelFabric,
    rope: modelRope,
    name: 'Felt · wool',
    accent: '#b6a6c7',
    opacity: 0.3,
  },
  jobs: {
    fabric: jobFabric,
    rope: jobRope,
    name: 'Twill · waxed cotton',
    accent: '#c29d85',
    opacity: 0.35,
  },
};
export const materialFor = (kind: string) => materials[kind] ?? materials.services;
