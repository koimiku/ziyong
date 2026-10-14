package com.anime.standalone;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.ColorFilter;
import android.graphics.PixelFormat;

// Resolution-independent circular forward action with a readable +85 label.
public final class Skip85Drawable extends Drawable {
    private int opacity = 255;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    @Override public void draw(Canvas canvas) {
        Rect b = getBounds();
        float size = Math.min(b.width(), b.height());
        float cx = b.exactCenterX(), cy = b.exactCenterY(), r = size * 0.36f;
        paint.setColor(Color.WHITE);
        paint.setAlpha(opacity);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(size * 0.045f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        canvas.drawArc(new RectF(cx-r, cy-r, cx+r, cy+r), -70, 300, false, paint);
        double angle = Math.toRadians(230);
        float x = cx + r * (float)Math.cos(angle), y = cy + r * (float)Math.sin(angle);
        float tx = -(float)Math.sin(angle), ty = (float)Math.cos(angle);
        Path arrow = new Path();
        arrow.moveTo(x, y);
        arrow.lineTo(x - tx*size*.15f + ty*size*.085f, y - ty*size*.15f - tx*size*.085f);
        arrow.lineTo(x - tx*size*.15f - ty*size*.085f, y - ty*size*.15f + tx*size*.085f);
        arrow.close();
        paint.setStyle(Paint.Style.FILL);
        canvas.drawPath(arrow, paint);
        paint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        paint.setTextSize(size * .25f);
        paint.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics metrics = paint.getFontMetrics();
        canvas.drawText("+85", cx, cy - (metrics.ascent + metrics.descent)/2, paint);
    }
    @Override public void setAlpha(int alpha) { opacity = alpha; invalidateSelf(); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
}