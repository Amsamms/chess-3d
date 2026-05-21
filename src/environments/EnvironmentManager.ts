import * as THREE from 'three';
import { Environment, EnvironmentName } from './Environment';
import { GothicNight } from './GothicNight';
import { GardenDay } from './GardenDay';
import { IceRealm } from './IceRealm';
import { Volcano } from './Volcano';

/**
 * Owns the currently active Environment. setEnvironment() disposes the old
 * and builds the new — including its lights, sky, ground, particles.
 */
export class EnvironmentManager {
  private current: Environment | null = null;
  private elapsed = 0;

  constructor(private readonly scene: THREE.Scene) {}

  set(name: EnvironmentName): Environment {
    this.current?.dispose();
    const env = factory(name);
    env.build(this.scene);
    this.scene.add(env.group);
    this.current = env;
    return env;
  }

  getName(): EnvironmentName | null {
    if (!this.current) return null;
    switch (this.current.name) {
      case 'Gothic Night': return 'gothic-night';
      case 'Garden Day': return 'garden-day';
      case 'Ice Realm': return 'ice-realm';
      case 'Volcano': return 'volcano';
      default: return null;
    }
  }

  update(dt: number) {
    this.elapsed += dt;
    this.current?.update(dt);
  }
}

function factory(name: EnvironmentName): Environment {
  switch (name) {
    case 'gothic-night': return new GothicNight();
    case 'garden-day': return new GardenDay();
    case 'ice-realm': return new IceRealm();
    case 'volcano': return new Volcano();
  }
}

export const ENVIRONMENT_LABELS: Record<EnvironmentName, string> = {
  'gothic-night': 'Gothic Night',
  'garden-day': 'Garden Day',
  'ice-realm': 'Ice Realm',
  'volcano': 'Volcano',
};

export const ENVIRONMENT_ORDER: EnvironmentName[] = ['gothic-night', 'garden-day', 'ice-realm', 'volcano'];
