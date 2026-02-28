import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const basePath = path.join(process.cwd(), '../src/data/.pipeline');
    const vizPath = path.join(basePath, 'clustering-viz.json');
    const topicsPath = path.join(basePath, 'topics.json');

    if (!fs.existsSync(vizPath)) {
      return NextResponse.json({ error: 'Clustering visualization data not found' }, { status: 404 });
    }

    const vizData = JSON.parse(fs.readFileSync(vizPath, 'utf-8'));
    let topicsData = null;
    if (fs.existsSync(topicsPath)) {
      topicsData = JSON.parse(fs.readFileSync(topicsPath, 'utf-8'));
    }

    return NextResponse.json({ nodes: vizData, topics: topicsData });
  } catch (error) {
    console.error('Error reading clustering visualization data:', error);
    return NextResponse.json({ error: 'Failed to load clustering data' }, { status: 500 });
  }
}
