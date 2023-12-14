import { RigidBody, World } from '@dimforge/rapier2d';
import { Rapier } from '../physics/rapier';
import {
    Scene,
    InstancedMesh,
    CircleGeometry,
    Object3D,
    MeshBasicMaterial,
    Color,
    Clock
} from "three";
import { parse } from 'svg-parser';

import { Sound } from '../lib'

import demoBuildingsSVG from '../map/demo-buildings.svg?raw'
import demoTreesSVG from '../map/demo-trees.svg?raw'
// import demoWaterSVG from '../map/demo-water.svg?raw'
// import demoGrassSVG from '../map/demo-grass.svg?raw'

export class Map {
    public rapier: Rapier;
    public physicsWorld: World;
    public scene: Scene;
    public mapPoints: Array<MapPoint> = [];
    public mapPointInstancedMesh: InstancedMesh | undefined;
    public pointSize: number = .3;
    public clock: Clock = new Clock();

    public origin = { x: -110, y: 50 };
    public pointsFillGap = .5;
    public minPointDistance = 0.2;
    public pointsJitter = 0.2;

    public sounds: { reflectionBuilding: Sound, reflectionTree: Sound };

    constructor(
        rapier: Rapier,
        physicsWorld: World,
        scene: Scene,
        sounds: { reflectionBuilding: Sound, reflectionTree: Sound }
    ) {
        this.rapier = rapier;
        this.physicsWorld = physicsWorld;
        this.scene = scene;
        this.sounds = sounds;

        const buildingCoordinates = this.extractBuildingCoordinates();
        const treeCoordinates = this.extractTreeCoordinates();
        this.buildInstancedMesh(buildingCoordinates, treeCoordinates);

        this.clock.start();
    }

    public extractBuildingCoordinates() {
        // parse svg of city map to JSON
        console.log("Parsing SVG to JSON...")
        const parsedSvg = parse(demoBuildingsSVG);
        console.log("Done!")

        let segments: { x1: number, y1: number, x2: number, y2: number }[] = [];

        // extract coordinates from parsed JSON
        console.log("Extracting Line Segments...")
        parsedSvg.children.forEach((child: any) => {
            if (child.hasOwnProperty('children')) {
                child.children.forEach((nested: any) => {
                    // for polyline type svg
                    if (nested.tagName == 'polyline') {
                        let coordinates = nested.properties.points.split(" ");
                        coordinates = coordinates.map((coordinate: string) => parseFloat(coordinate));

                        for (let i = 0; i < coordinates.length - 3; i += 4) {
                            const segment = {
                                x1: coordinates[i] + this.origin.x,
                                y1: -coordinates[i + 1] + this.origin.y,
                                x2: coordinates[i + 2] + this.origin.x,
                                y2: -coordinates[i + 3] + this.origin.y
                            }
                            segments.push(segment);
                        }
                    }
                })
            }
        })
        console.log(`Done, created ${segments.length} segments!`);

        let coordinates: { x: number, y: number, type: string }[] = [];
        console.log("Creating points along segments...")
        segments.forEach((segment) => {
            const { x1, y1, x2, y2 } = segment;
            const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

            if (length > 0) {
                let progress = 0;
                while (progress < length) {
                    const x = x1 + (x2 - x1) * (progress / length);
                    const y = y1 + (y2 - y1) * (progress / length);
                    coordinates.push({ x: x, y: y, type: "building" });
                    progress += this.pointsFillGap;
                }
            } else {
                coordinates.push({ x: x1, y: y1, type: "building" });
            }
        })
        console.log(`Done, created ${coordinates.length} points!`)

        console.log("Adding jitter to points...")
        coordinates.forEach(coordinate => {
            coordinate.x += this.pointsJitter * (Math.random() - 0.5);
            coordinate.y += this.pointsJitter * (Math.random() - 0.5);
        })
        console.log("Done!")

        return coordinates;
    }

    public extractTreeCoordinates() {
        // parse svg of city map to JSON
        console.log("Parsing SVG to JSON...")
        const parsedSvg = parse(demoTreesSVG);
        console.log("Done!")

        let segments: { x1: number, y1: number, x2: number, y2: number }[] = [];

        // extract coordinates from parsed JSON
        console.log("Extracting Line Segments...")
        parsedSvg.children.forEach((child: any) => {
            if (child.hasOwnProperty('children')) {
                child.children.forEach((nested: any) => {
                    // for polyline type svg
                    if (nested.tagName == 'polyline') {
                        let coordinates = nested.properties.points.split(" ");
                        coordinates = coordinates.map((coordinate: string) => parseFloat(coordinate));

                        for (let i = 0; i < coordinates.length - 3; i += 4) {
                            const segment = {
                                x1: coordinates[i] + this.origin.x,
                                y1: -coordinates[i + 1] + this.origin.y,
                                x2: coordinates[i + 2] + this.origin.x,
                                y2: -coordinates[i + 3] + this.origin.y
                            }
                            segments.push(segment);
                        }
                    }
                })
            }
        })
        console.log(`Done, created ${segments.length} segments!`);

        let coordinates: { x: number, y: number, type: string }[] = [];
        console.log("Creating points along segments...")
        segments.forEach((segment) => {
            const { x1, y1, x2, y2 } = segment;
            const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

            if (length > 0) {
                let progress = 0;
                while (progress < length) {
                    const x = x1 + (x2 - x1) * (progress / length);
                    const y = y1 + (y2 - y1) * (progress / length);
                    coordinates.push({ x: x, y: y, type: "tree" });
                    progress += this.pointsFillGap;
                }
            } else {
                coordinates.push({ x: x1, y: y1, type: "tree" });
            }
        })
        console.log(`Done, created ${coordinates.length} points!`)

        console.log("Adding jitter to points...")
        coordinates.forEach(coordinate => {
            coordinate.x += this.pointsJitter * (Math.random() - 0.5);
            coordinate.y += this.pointsJitter * (Math.random() - 0.5);
        })
        console.log("Done!")

        return coordinates;
    }

    public buildInstancedMesh(buildingCoordinates: { x: number, y: number, type: string }[], treeCoordinates: { x: number, y: number, type: string }[]) {

        const coordinates = buildingCoordinates.concat(treeCoordinates);

        // TODO: set size and color based on object type
        const geometry = new CircleGeometry(this.pointSize, 5);
        const material = new MeshBasicMaterial({ color: 0xffffff });
        const count = coordinates.length;

        this.mapPointInstancedMesh = new InstancedMesh(geometry, material, count);
        this.scene.add(this.mapPointInstancedMesh);

        // create points
        const dummy = new Object3D();
        coordinates.forEach((coordinate, i) => {
            // create points for physics simulation
            let soundAssignment: Sound;

            if (coordinate.type == "building") {
                soundAssignment = this.sounds.reflectionBuilding;
            } else if (coordinate.type == "tree") {
                soundAssignment = this.sounds.reflectionTree;
            } else {
                soundAssignment = this.sounds.reflectionBuilding;
            }

            const newPoint = new MapPoint(this.rapier, this.physicsWorld!, coordinate.type, coordinate.x, coordinate.y, this.pointSize, soundAssignment);
            this.mapPoints.push(newPoint);

            // set positions of rendered points in instanced mesh
            dummy.position.set(coordinate.x, coordinate.y, 0);
            dummy.rotation.z = Math.random() * Math.PI;
            dummy.updateMatrix();
            this.mapPointInstancedMesh!.setMatrixAt(i, dummy.matrix);
        })
    }

    public update() {
        const dummy = new Object3D();

        // set positions of rendered points in instanced mesh
        this.mapPoints.forEach((mapPoint, i) => {
            let color = new Color(0x000000);

            let brightness = 1;
            let jitterScale = 0;
            let jitter = { x: 0, y: 0 };
            let scale = 1;

            if (mapPoint.state == "collided") {
                switch (mapPoint.type) {
                    case "building":
                        brightness = Math.max(1 - (mapPoint.clock.getElapsedTime() / mapPoint.brightnessDecayTime), .3) * 100;
                        brightness += 10 * Math.cos(3 * (mapPoint.hue + this.clock.getElapsedTime()));
                        brightness = Math.min(100, Math.max(0, brightness));
                        color = new Color(`hsl(${mapPoint.hue}, 100%, ${brightness}%)`);

                        jitterScale = .3 * Math.max(1 - (mapPoint.clock.getElapsedTime() / (mapPoint.brightnessDecayTime / 2.5)), .1);
                        jitter = { x: Math.random() * jitterScale, y: Math.random() * jitterScale }
                        dummy.position.set(mapPoint.x + jitter.x, mapPoint.y + jitter.y, 0);

                        scale = .6 + brightness / 200;
                        dummy.scale.set(scale, scale, 1);
                        dummy.updateMatrix();

                        break;

                    case "tree":
                        brightness = Math.max(1 - (mapPoint.clock.getElapsedTime() / mapPoint.brightnessDecayTime), .3) * 100;
                        brightness += 10 * Math.cos(3 * (mapPoint.hue + this.clock.getElapsedTime()));
                        brightness = Math.min(100, Math.max(0, brightness));
                        color = new Color(`hsl(${mapPoint.hue}, 100%, ${brightness}%)`);

                        jitterScale = .3 * Math.max(1 - (mapPoint.clock.getElapsedTime() / (mapPoint.brightnessDecayTime / 2.5)), .1);
                        jitter = { x: Math.random() * jitterScale, y: Math.random() * jitterScale }
                        dummy.position.set(mapPoint.x + jitter.x, mapPoint.y + jitter.y, 0);

                        scale = .6 + brightness / 200;
                        dummy.scale.set(scale, scale, 1);
                        dummy.updateMatrix();

                        break;

                }

                this.mapPointInstancedMesh!.setMatrixAt(i, dummy.matrix);

                if (this.mapPointInstancedMesh!.instanceMatrix) {
                    this.mapPointInstancedMesh!.instanceMatrix.needsUpdate = true;
                }
            }
            this.mapPointInstancedMesh!.setColorAt(i, color);

            if (this.mapPointInstancedMesh!.instanceColor) {
                this.mapPointInstancedMesh!.instanceColor.needsUpdate = true;
            }
        })
    }
}

export class MapPoint {
    public rapier: Rapier;
    public type: string;
    public handle: number = -1;
    public state: string = "hidden";
    public x: number;
    public y: number;
    public surfaceBody: RigidBody;
    public pointSize: number = .1;
    public reflectedSound: Sound;
    public clock: Clock = new Clock();
    public brightnessDecayTime = 5;
    public hue: number;

    constructor(
        rapier: Rapier,
        physicsWorld: World,
        type: string,
        x: number,
        y: number,
        pointSize: number,
        reflectedSound: Sound
    ) {
        this.rapier = rapier;
        this.type = type;
        this.x = x;
        this.y = y;
        this.pointSize = pointSize;
        this.reflectedSound = reflectedSound;

        // Create physics simulation point
        const rbDesc = this.rapier.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(this.x, this.y)
            .setCcdEnabled(true);
        this.surfaceBody = physicsWorld.createRigidBody(rbDesc);

        // Create collider for point
        const clDesc = this.rapier.ColliderDesc.ball(this.pointSize)
            .setFriction(0.0)
            .setFrictionCombineRule(this.rapier.CoefficientCombineRule.Max)
            .setRestitution(1.0)
            .setRestitutionCombineRule(this.rapier.CoefficientCombineRule.Max)
            .setCollisionGroups(0x00020001)
            .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
        physicsWorld!.createCollider(clDesc, this.surfaceBody);

        // Capture unique identifier for point body
        this.handle = this.surfaceBody.handle;

        // Set hue based on point type
        switch (this.type) {
            case "building":
                this.hue = (Math.floor(Math.random() * 70) + 280) % 360;

                break;
            case "tree":
                this.hue = (Math.floor(Math.random() * 30) + 85) % 360;

                break;
            default:
                this.hue = 0;

                break;
        }

    }

    public setState(state: string) {
        this.state = state;
    }

    public playReflectedSound(volume: number, detune: number) {
        this.reflectedSound.play(volume, detune);
    }
}
