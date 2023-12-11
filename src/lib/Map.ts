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

import mapSVG from '../map/block.svg?raw'
// import mapSVG from '../map/buildings.svg?raw'
import treeCSV from '../map/municipal-trees-small.csv?raw'

export class Map {
    rapier!: Rapier;
    physicsWorld?: World;
    scene: Scene;
    mapPoints: Array<MapPoint> = []
    renderedBuildingMesh: InstancedMesh;
    renderedTreeMesh: InstancedMesh;
    pointSize: number = .1;
    clock: Clock = new Clock();

    // origin = { x: -120, y: 230 };
    origin = { x: -57, y: 51 };
    pointsFillGap = 0.1;
    minPointDistance = 0.05;
    pointsJitter = 0.2;

    constructor(
        rapier: Rapier,
        physicsWorld: World,
        scene: Scene,
    ) {
        this.rapier = rapier;
        this.physicsWorld = physicsWorld;
        this.scene = scene;

        this.buildBuildings();
        // this.buildTrees();

        this.clock.start();
    }

    public buildBuildings() {
        // parse svg of city map to JSON
        console.log("Parsing SVG to JSON...")
        const parsedSvg = parse(mapSVG);
        console.log("Done!")

        let segments: { x1: number, y1: number, x2: number, y2: number }[] = [];

        // extract coordinates from parsed JSON
        console.log("Extracting Line Segments...")
        parsedSvg.children.forEach(child => {
            if (child.hasOwnProperty('children')) {
                child.children.forEach(nested => {
                    nested.children.forEach(polygon => {
                        // TODO: use endpoints to interpolate points in between lines
                        let { x1, y1, x2, y2 } = polygon.properties;
                        if (x1 & y1 & x2 & y2) {
                            // Offset points by origin they spawn in view and correct for y inversion
                            x1 += this.origin.x;
                            y1 = -y1 + this.origin.y;
                            x2 += this.origin.x;
                            y2 = -y2 + this.origin.y;
                            segments.push({ x1, y1, x2, y2 });
                        }
                    })
                })
            }
        })
        console.log(`Done, created ${segments.length} segments!`);

        // Remove duplicate segments
        // TODO: temporary, should not need to filter duplicate points at runtime
        console.log("Removing duplicate segments...")
        segments = segments!.filter((value, index, self) =>
            index === self.findIndex((t) => (
                (t.x1 === value.x1 && t.y1 === value.y1 && t.x2 === value.x2 && t.y2 === value.y2) || (t.x1 === value.x2 && t.y1 === value.y2 && t.x2 === value.x1 && t.y2 === value.y1)
            ))
        )
        console.log(`Done, there are now ${segments.length} segments!`);

        let coordinates: { x: number, y: number }[] = [];

        console.log("Creating points along segments...")
        segments.forEach((segment) => {
            const { x1, y1, x2, y2 } = segment;
            const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

            if (length > 0) {
                let progress = 0;
                while (progress < length) {
                    const x = x1 + (x2 - x1) * (progress / length);
                    const y = y1 + (y2 - y1) * (progress / length);
                    coordinates.push({ x, y });
                    progress += this.pointsFillGap;
                }
            } else {
                coordinates.push({ x: x1, y: y1 });
            }
        })
        console.log(`Done, created ${coordinates.length} points!`)

        console.log("Merging coordinates by distance threshold...")
        coordinates = coordinates!.filter((value, index, self) =>
            index === self.findIndex((t) => (
                (Math.abs(t.x - value.x) < this.minPointDistance) && (Math.abs(t.y - value.y) < this.minPointDistance)
            ))
        )
        console.log(`Done, there are now ${coordinates.length} points!`);

        console.log("Adding jitter to points...")
        coordinates.forEach(coordinate => {
            coordinate.x += this.pointsJitter * (Math.random() - 0.5);
            coordinate.y += this.pointsJitter * (Math.random() - 0.5);
        })
        console.log("Done!")

        // TODO: set size and color based on object type
        const geometry = new CircleGeometry(this.pointSize, 5);
        const material = new MeshBasicMaterial({ color: 0xffffff });
        const count = coordinates.length;

        this.renderedBuildingMesh = new InstancedMesh(geometry, material, count);
        this.scene.add(this.renderedBuildingMesh);

        // create points
        const dummy = new Object3D();
        coordinates.forEach((coordinate, i) => {
            // create points for physics simulation
            const newPoint = new MapPoint('building', coordinate.x, coordinate.y, this.pointSize);
            newPoint.attach(this.rapier, this.physicsWorld);
            this.mapPoints.push(newPoint);

            // set positions of rendered points in instanced mesh
            dummy.position.set(coordinate.x, coordinate.y, 0);
            dummy.rotation.z = Math.random() * Math.PI;
            dummy.updateMatrix();
            this.renderedBuildingMesh.setMatrixAt(i, dummy.matrix);
        })
    }

    public buildTrees() {
        const treesCoordinate = this.ingestCSV(treeCSV);
        let treePoints: { x: number, y: number }[] = [];

        treesCoordinate.forEach(tree => {
            const singleTreePoints = this.buildSingleTreePoints(tree);
            singleTreePoints.forEach((point: { x: number, y: number }) => {
                treePoints.push(point);
            })
        })

        const geometry = new CircleGeometry(.2, 5);
        const material = new MeshBasicMaterial({ color: 0x00ff00 });
        const count = treePoints.length;

        this.renderedTreeMesh = new InstancedMesh(geometry, material, count);
        this.scene.add(this.renderedTreeMesh);

        // create points
        const dummy = new Object3D();
        treePoints.forEach((treePoint, i) => {
            // create points for physics simulation
            const newPoint = new MapPoint('tree', treePoint.x, treePoint.y);
            newPoint.attach(this.rapier, this.physicsWorld);
            this.mapPoints.push(newPoint);

            // set positions of rendered points in instanced mesh
            dummy.position.set(treePoint.x, treePoint.y, 0);
            dummy.rotation.z = Math.random() * Math.PI;
            dummy.updateMatrix();
            this.renderedTreeMesh.setMatrixAt(i, dummy.matrix);
        })
    }

    // Spiralized trees
    private buildSingleTreePoints(tree: { id: string, age: number, height: number, x: number, y: number }) {
        let points: { x: number, y: number }[] = [];
        const maxAngle = 10;

        let angle = 0;
        let radius = .1;
        while (angle < maxAngle) {
            let x = tree.x + Math.sin(angle) * radius;
            let y = tree.y + Math.cos(angle) * radius;
            points.push({ x, y });
            radius += .1;
            angle += 1;
        }
        return points
    }

    private ingestCSV(csv: string) {
        let lines = csv.split("\n");
        let result = [];

        for (let i = 1; i < lines.length; i++) {
            let tree: { id: string, age: number, height: number, x: number, y: number } = {};
            let currentline = lines[i].split(",");

            tree.id = currentline[0];
            tree.age = 2023 - parseInt(currentline[1]);
            tree.height = parseFloat(currentline[2].split(" ")[0]);

            let coordinates = currentline[3].split("POINT (");
            coordinates = coordinates[1].split(" ");
            coordinates[1] = coordinates[1].split(")")[0];
            tree.x = parseFloat(coordinates[0]) * 20000 - 249800;
            tree.y = parseFloat(coordinates[1]) * 20000 - 1114100;

            result.push(tree);
        }

        return result; //JSON
    }

    public update() {
        this.mapPoints.forEach((mapPoint, i) => {
            this.updaterenderedBuildingMeshColor(i, mapPoint);
        })
    }

    // TODO: set color based on object type too
    public updaterenderedBuildingMeshColor(index: number, mapPoint: MapPoint) {
        let color = new Color(0x000000);

        switch (mapPoint.state) {
            case "collided":
                let brightness = Math.max(1 - (mapPoint.clock.getElapsedTime() / mapPoint.brightnessDecayTime), .3) * 100;
                brightness += 10 * Math.cos(3 * (mapPoint.hue + this.clock.getElapsedTime()));
                brightness = Math.min(100, Math.max(0, brightness));
                color = new Color(`hsl(${mapPoint.hue}, 100%, ${brightness}%)`);
                break;
        }

        this.renderedBuildingMesh.setColorAt(index, color);

        if (this.renderedBuildingMesh.instanceColor) {
            this.renderedBuildingMesh.instanceColor.needsUpdate = true;
        }
    }

    // TODO: specify type of collision based on type of material contacted
    public checkCollisionEvents(handle1: number, handle2: number) {
        this.mapPoints.forEach((point) => {
            if (point.handle == handle1 || point.handle == handle2) {
                point.setState('collided');
                point.clock.start();
            }
        })
    }
}

class MapPoint {
    public type: string;
    public handle: number;
    public state: string = "hidden";
    public x: number;
    public y: number;
    public surfaceBody: RigidBody;
    private pointSize: number = .1;
    public clock: Clock = new Clock();
    public brightnessDecayTime = 10;
    public hue = (Math.floor(Math.random() * 70) + 280) % 360;

    constructor(type: string, x: number, y: number, pointSize: number) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.pointSize = pointSize;
    }

    public attach(rapier: Rapier, physicsWorld: World) {
        // Create physics simulation point
        const rbDesc = rapier.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(this.x, this.y)
            .setCcdEnabled(true);
        this.surfaceBody = physicsWorld!.createRigidBody(rbDesc);

        // Create collider for point
        const clDesc = rapier.ColliderDesc.ball(this.pointSize, this.pointSize)
            // const clDesc = rapier.ColliderDesc.cuboid(this.pointSize, this.pointSize)
            .setFriction(0.0)
            .setFrictionCombineRule(rapier.CoefficientCombineRule.Max)
            .setRestitution(1.0)
            .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max)
            .setCollisionGroups(0x00020001)
            .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
        physicsWorld!.createCollider(clDesc, this.surfaceBody);

        // Capture unique identifier for point body
        this.handle = this.surfaceBody.handle;
    }

    public setState(state: string) {
        this.state = state;
    }
}
