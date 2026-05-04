// OP
export class VectorArrow {
  constructor(carController) {
    this.car = carController;
  }

  draw(ctx) {
    // We draw the arrow starting from the center of the car
    const speed = this.car.speed;
    
    // Only draw arrow if moving
    if (Math.abs(speed) < 0.1) return;

    // The length of the arrow scales with speed
    const arrowLength = 20 + Math.abs(speed) * 3;
    const angle = this.car.angle;

    ctx.save();
    ctx.translate(this.car.x, this.car.y);
    ctx.rotate(angle);

    // Draw line
    ctx.beginPath();
    ctx.moveTo(0, 0);
    // Draw forward or backward based on speed direction
    const dirMult = speed >= 0 ? 1 : -1;
    ctx.lineTo(arrowLength * dirMult, 0);
    
    ctx.strokeStyle = '#06b6d4'; // Neon cyan color
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw arrowhead
    ctx.beginPath();
    ctx.moveTo(arrowLength * dirMult, 0);
    ctx.lineTo((arrowLength - 8) * dirMult, -6);
    ctx.lineTo((arrowLength - 8) * dirMult, 6);
    ctx.closePath();
    ctx.fillStyle = '#06b6d4';
    ctx.fill();

    ctx.restore();
  }
}
