import { NextRequest, NextResponse } from "next/server";

type Body = {
  coordinates: [number, number][];
};

type OsrmResponse = {
  code: string;
  routes?: Array<{
    geometry: {
      coordinates: [number, number][];
    };
  }>;
};

export async function POST(request: NextRequest) {
  let body: Body;

  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !Array.isArray(body.coordinates) ||
    body.coordinates.length < 2 ||
    body.coordinates.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        typeof point[0] !== "number" ||
        typeof point[1] !== "number",
    )
  ) {
    return NextResponse.json(
      { error: "coordinates must be an array of [lat, lng] pairs" },
      { status: 400 },
    );
  }

  const coordinates = body.coordinates
    .map(([lat, lng]) => `${lng},${lat}`)
    .join(";");

  const url =
    `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
    "?overview=full&geometries=geojson&steps=false&annotations=false";

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Aegis-999-Dispatch-Simulator/1.0",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Routing provider returned ${response.status}` },
        { status: 502 },
      );
    }

    const data = (await response.json()) as OsrmResponse;

    if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates) {
      return NextResponse.json(
        { error: "Routing provider returned no route geometry" },
        { status: 502 },
      );
    }

    const route = data.routes[0].geometry.coordinates.map(
      ([lng, lat]) => [lat, lng] as [number, number],
    );

    return NextResponse.json({ route });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach routing provider" },
      { status: 502 },
    );
  }
}
