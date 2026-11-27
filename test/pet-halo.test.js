"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeHaloBounds,
  computeHaloHotZone,
  pointInHaloHotZone,
} = require("../src/pet-halo").__test;

describe("pet-halo layout and hover bridge geometry", () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };

  it("positions the halo centered below the pet when room is available", () => {
    const hitRect = { left: 660, top: 420, right: 780, bottom: 540 };
    const layout = computeHaloBounds({
      hitRect,
      workArea,
      width: 296,
      height: 184,
      scale: 1,
    });

    assert.equal(layout.flippedAbove, false);
    assert.equal(layout.bounds.x, Math.round(720 - 296 / 2));
    assert.ok(layout.bounds.y > hitRect.bottom);
  });

  it("flips the halo above the pet near the bottom screen edge", () => {
    const hitRect = { left: 660, top: 760, right: 780, bottom: 880 };
    const layout = computeHaloBounds({
      hitRect,
      workArea,
      width: 296,
      height: 184,
      scale: 1,
    });

    assert.equal(layout.flippedAbove, true);
    assert.ok(layout.bounds.y + layout.bounds.height <= hitRect.top);
    assert.ok(layout.bounds.y >= workArea.y);
  });

  it("clamps horizontal bounds cleanly near left and right display edges", () => {
    const leftEdge = computeHaloBounds({
      hitRect: { left: 4, top: 300, right: 104, bottom: 400 },
      workArea,
      width: 296,
      height: 184,
      scale: 1,
    });
    assert.ok(leftEdge.bounds.x >= workArea.x + 8);

    const rightEdge = computeHaloBounds({
      hitRect: { left: 1360, top: 300, right: 1460, bottom: 400 },
      workArea,
      width: 296,
      height: 184,
      scale: 1,
    });
    assert.ok(rightEdge.bounds.x + rightEdge.bounds.width <= workArea.x + workArea.width - 8);
  });

  it("keeps cursor inside the safe bridge corridor between pet and halo dock", () => {
    const hitRect = { left: 600, top: 400, right: 700, bottom: 500 };
    const layout = computeHaloBounds({
      hitRect,
      workArea,
      width: 296,
      height: 184,
      scale: 1,
    });
    const hotZone = computeHaloHotZone({
      petHitRect: hitRect,
      haloBounds: layout.bounds,
    });

    // Direct gap between pet bottom and halo top must stay inside hotZone
    const gapPoint = { x: 650, y: hitRect.bottom + 4 };
    assert.equal(pointInHaloHotZone(gapPoint, hotZone), true);

    // Diagonal travel toward outer corner of halo dock must stay inside bridge
    const diagonalBridgePoint = { x: layout.bounds.x + 24, y: layout.bounds.y - 3 };
    assert.equal(pointInHaloHotZone(diagonalBridgePoint, hotZone), true);


    // Far desktop point must NOT be intercepted or keep hover alive
    assert.equal(pointInHaloHotZone({ x: 200, y: 200 }, hotZone), false);
  });
});
