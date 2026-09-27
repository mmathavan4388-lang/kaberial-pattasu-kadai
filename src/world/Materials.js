// Shared material library. Sharing materials = shared shader programs + batched state.
import * as THREE from 'three';
import { TextureFactory } from './Textures.js';

export class Materials {
  constructor(preset) {
    this.factory = new TextureFactory(preset);
    const f = this.factory;
    const facades = f.buildFacades();
    this.signData = f.buildSigns();

    this.facade = new THREE.MeshStandardMaterial({
      map: facades.map, emissiveMap: facades.emissive, emissive: 0xffffff, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.92, metalness: 0,
    });
    const low = f.buildLowFacade();
    this.facadeLow = new THREE.MeshStandardMaterial({
      map: low.map, emissiveMap: low.emissive, emissive: 0xffffff, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.92, metalness: 0,
    });
    this.detail = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 });
    this.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 });
    this.signs = new THREE.MeshStandardMaterial({
      map: this.signData.map, emissiveMap: this.signData.emissive, emissive: 0xffffff, emissiveIntensity: 0,
      roughness: 0.6, side: THREE.DoubleSide,
    });
    const road = f.buildRoad(true);
    const rural = f.buildRoad(false);
    this.road = new THREE.MeshStandardMaterial({ map: road, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.roadRural = new THREE.MeshStandardMaterial({ map: rural, roughness: 0.97, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.junction = new THREE.MeshStandardMaterial({ color: 0x4a4a4c, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const paving = f.buildPaving();
    this.sidewalk = new THREE.MeshStandardMaterial({ map: paving, roughness: 0.9, vertexColors: true });
    const soil = f.buildSoil();
    soil.repeat.set(1, 1);
    this.ground = new THREE.MeshStandardMaterial({ map: soil, vertexColors: true, roughness: 1 });
    this.crops = new THREE.MeshStandardMaterial({ map: f.buildCrops(), vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.tree = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide });
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.5 });
    this.glow = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.9, depthWrite: false });
    this.wire = new THREE.LineBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.7 });

    this.nightMaterials = [this.facade, this.signs, this.lamp];
  }

  /** 0 = day, 1 = full night. Drives lit windows, glowing signs and street lamps. */
  setNight(n) {
    this.facade.emissiveIntensity = n * 0.65;
    this.facadeLow.emissiveIntensity = n * 0.55;
    this.signs.emissiveIntensity = 0.05 + n * 0.9;
    this.lamp.emissiveIntensity = n * 3;
  }

  signUV(key) {
    const c = this.signData.cells.get(key);
    return c ? [c.u0, c.v0, c.u1, c.v1] : [0, 0, 0.01, 0.01];
  }
}
