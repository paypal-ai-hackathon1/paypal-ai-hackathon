// Typhoon Yagi (storm no. 3), September 2024: replay fixture.
// The storm and its rough timing are real: landfall on the Quang Ninh - Hai Phong coast on
// Sep 7, 2024. Everything else is SIMULATED for the demo: partners, households, forecast
// values and bulletin wording. Households and names are fictional; phone numbers use the
// impossible "+84 000 000 ..." range.
//
// Planted cases for the suspicious-household checks (#13), keep them when editing:
// - hh-qn-13 has the same phone number as hh-qn-04
// - hh-qn-14 has the same address as hh-qn-07
// - hh-hp-07 to hh-hp-10 all registered with partner-hp within one hour, the night before landfall

import type { Bulletin, ForecastMetric, ForecastPoint, Household, Scenario } from "@/lib/domain";

const PROVINCES = [
  { id: "quang-ninh", name: "Quang Ninh", nameVi: "Quảng Ninh" },
  { id: "hai-phong", name: "Hai Phong", nameVi: "Hải Phòng" },
  { id: "thai-binh", name: "Thai Binh", nameVi: "Thái Bình" },
];

const PARTNERS = [
  { id: "partner-qn", name: "Cua Gio Community Relief Group", provinceId: "quang-ninh", contactName: "Lê Thu Hà" },
  { id: "partner-hp", name: "Ben Loi Coastal Aid", provinceId: "hai-phong", contactName: "Trần Quốc Bảo" },
  { id: "partner-tb", name: "Dong Lua Farmers Mutual Aid", provinceId: "thai-binh", contactName: "Phạm Minh Châu" },
];

const AREA = {
  qn: { provinceId: "quang-ninh", partnerId: "partner-qn", address: (n: number) => `Tổ ${n}, khu Cửa Gió, Hạ Long`, phoneBlock: 1 },
  hp: { provinceId: "hai-phong", partnerId: "partner-hp", address: (n: number) => `Thôn ${n}, xã Bến Lội, Thủy Nguyên`, phoneBlock: 2 },
  tb: { provinceId: "thai-binh", partnerId: "partner-tb", address: (n: number) => `Xóm ${n}, xã Đồng Lúa, Thái Thụy`, phoneBlock: 3 },
};

function household(
  area: keyof typeof AREA,
  n: number,
  headName: string,
  members: number,
  registeredAt: string,
  receiptCode: string,
  overrides: Partial<Household> = {},
): Household {
  const a = AREA[area];
  const nn = String(n).padStart(2, "0");
  return {
    id: `hh-${area}-${nn}`,
    partnerId: a.partnerId,
    provinceId: a.provinceId,
    headName,
    members,
    phone: `+84 000 000 ${a.phoneBlock}${nn}`,
    address: a.address(n),
    registeredAt,
    receiptCode,
    ...overrides,
  };
}

const HOUSEHOLDS: Household[] = [
  // Quang Ninh: 14 households
  household("qn", 1, "Nguyễn Văn An", 4, "2024-03-12T09:15:00+07:00", "QN-7K2P"),
  household("qn", 2, "Trần Thị Bình", 3, "2024-03-12T10:02:00+07:00", "QN-3M8T"),
  household("qn", 3, "Lê Văn Cường", 5, "2024-03-19T14:30:00+07:00", "QN-9X4R"),
  household("qn", 4, "Phạm Thị Dung", 2, "2024-04-02T08:45:00+07:00", "QN-2H6W"),
  household("qn", 5, "Hoàng Văn Em", 6, "2024-04-02T09:20:00+07:00", "QN-5C3N"),
  household("qn", 6, "Vũ Thị Giang", 4, "2024-04-16T15:10:00+07:00", "QN-8V7D"),
  household("qn", 7, "Đặng Văn Hải", 3, "2024-04-23T10:40:00+07:00", "QN-4J9F"),
  household("qn", 8, "Bùi Thị Hoa", 1, "2024-05-07T09:05:00+07:00", "QN-6B2L"),
  household("qn", 9, "Đỗ Văn Khánh", 5, "2024-05-14T16:25:00+07:00", "QN-3R5Y"),
  household("qn", 10, "Ngô Thị Lan", 4, "2024-05-21T11:50:00+07:00", "QN-7T8H"),
  household("qn", 11, "Dương Văn Minh", 2, "2024-06-04T08:30:00+07:00", "QN-2W4C"),
  household("qn", 12, "Lý Thị Nga", 3, "2024-06-11T13:15:00+07:00", "QN-9N6M"),
  household("qn", 13, "Trịnh Văn Phúc", 4, "2024-06-18T10:00:00+07:00", "QN-5D3K", {
    phone: "+84 000 000 104", // planted: same phone as hh-qn-04
  }),
  household("qn", 14, "Mai Thị Quyên", 2, "2024-06-25T15:45:00+07:00", "QN-8F7X", {
    address: "Tổ 7, khu Cửa Gió, Hạ Long", // planted: same address as hh-qn-07
  }),

  // Hai Phong: 10 households
  household("hp", 1, "Phan Văn Sơn", 5, "2024-03-08T09:30:00+07:00", "HP-4L2V"),
  household("hp", 2, "Hồ Thị Tâm", 3, "2024-03-22T10:10:00+07:00", "HP-6Y9B"),
  household("hp", 3, "Tạ Văn Thắng", 4, "2024-04-09T14:00:00+07:00", "HP-3H5J"),
  household("hp", 4, "Lưu Thị Uyên", 2, "2024-04-30T08:50:00+07:00", "HP-8C2R"),
  household("hp", 5, "Cao Văn Vinh", 6, "2024-05-17T11:35:00+07:00", "HP-5M7W"),
  household("hp", 6, "Đinh Thị Xuân", 3, "2024-06-12T16:20:00+07:00", "HP-2K4T"),
  // planted: four registrations within one hour, the night before landfall
  household("hp", 7, "Kiều Văn Yên", 4, "2024-09-06T21:05:00+07:00", "HP-9P6N"),
  household("hp", 8, "Chu Thị Ánh", 4, "2024-09-06T21:14:00+07:00", "HP-7X3D"),
  household("hp", 9, "Lâm Văn Bảo", 4, "2024-09-06T21:26:00+07:00", "HP-4F8Y"),
  household("hp", 10, "Tô Thị Cúc", 4, "2024-09-06T21:41:00+07:00", "HP-6R2H"),

  // Thai Binh: 8 households
  household("tb", 1, "Quách Văn Đức", 5, "2024-03-15T09:00:00+07:00", "TB-3W7M"),
  household("tb", 2, "Triệu Thị Hạnh", 3, "2024-03-29T10:45:00+07:00", "TB-8N4C"),
  household("tb", 3, "Văn Đình Hùng", 4, "2024-04-12T14:20:00+07:00", "TB-5T9K"),
  household("tb", 4, "La Thị Kim", 2, "2024-04-26T08:35:00+07:00", "TB-2D6P"),
  household("tb", 5, "Thân Văn Long", 6, "2024-05-10T15:55:00+07:00", "TB-7J3X"),
  household("tb", 6, "Ông Thị Mến", 1, "2024-05-24T09:40:00+07:00", "TB-4V8F"),
  household("tb", 7, "Khúc Văn Nam", 3, "2024-06-07T11:25:00+07:00", "TB-9B5L"),
  household("tb", 8, "Âu Thị Oanh", 4, "2024-06-21T13:05:00+07:00", "TB-6H2R"),
];

// Forecasts for the 24 hours from 19:00 on Sep 7, issued 72, 48 and 24 hours ahead.
// Values are simulated, chosen so that Thai Binh crosses the 150 mm rule only at 24 hours.
const VALID_FROM = "2024-09-07T19:00:00+07:00";
const ISSUED = { 72: "2024-09-04T19:00:00+07:00", 48: "2024-09-05T19:00:00+07:00", 24: "2024-09-06T19:00:00+07:00" };

const FORECAST_VALUES: [provinceId: string, metric: ForecastMetric, lead72: number, lead48: number, lead24: number][] = [
  ["quang-ninh", "rain_24h_mm", 120, 180, 250],
  ["hai-phong", "rain_24h_mm", 110, 160, 220],
  ["thai-binh", "rain_24h_mm", 90, 140, 170],
  ["quang-ninh", "wind_gust_kmh", 133, 166, 183],
  ["hai-phong", "wind_gust_kmh", 118, 149, 166],
  ["thai-binh", "wind_gust_kmh", 89, 118, 133],
];

const FORECAST: ForecastPoint[] = FORECAST_VALUES.flatMap(([provinceId, metric, ...values]) =>
  ([72, 48, 24] as const).map((leadHours, i) => ({
    id: `fc-${provinceId}-${metric}-${leadHours}h`,
    provinceId,
    metric,
    value: values[i],
    issuedAt: ISSUED[leadHours],
    validFrom: VALID_FROM,
    leadHours,
  })),
);

const ISSUER = "Trung tâm Dự báo Khí tượng Thủy văn Quốc gia (simulated)";

// Simulated bulletins in the style of Vietnam's national typhoon warnings. Not real texts.
const BULLETINS: Bulletin[] = [
  {
    id: "bulletin-yagi-1",
    issuedAt: "2024-09-05T11:00:00+07:00",
    issuer: ISSUER,
    language: "vi",
    simulated: true,
    text: [
      "TIN BÃO TRÊN BIỂN ĐÔNG (CƠN BÃO SỐ 3 - YAGI)",
      "Hồi 10 giờ ngày 05/9, vị trí tâm bão ở vào khoảng 18,9 độ Vĩ Bắc; 115,5 độ Kinh Đông. Sức gió mạnh nhất vùng gần tâm bão mạnh cấp 14 (150-166 km/h), giật trên cấp 17.",
      "Dự báo trong 48 giờ tới, bão di chuyển theo hướng Tây Tây Bắc, mỗi giờ đi được khoảng 10-15 km, có khả năng tiếp tục mạnh thêm.",
      "Cảnh báo mưa lớn: từ đêm 06/9 đến hết ngày 08/9, khu vực Quảng Ninh, Hải Phòng và Thái Bình có mưa to đến rất to với lượng mưa phổ biến 150-250 mm, có nơi trên 300 mm.",
      "Cấp độ rủi ro thiên tai do bão: cấp 4 trên vùng biển phía Bắc Biển Đông.",
    ].join("\n"),
  },
  {
    id: "bulletin-yagi-2",
    issuedAt: "2024-09-06T11:00:00+07:00",
    issuer: ISSUER,
    language: "vi",
    simulated: true,
    text: [
      "TIN BÃO KHẨN CẤP (CƠN BÃO SỐ 3 - YAGI)",
      "Hồi 10 giờ ngày 06/9, vị trí tâm bão ở vào khoảng 20,0 độ Vĩ Bắc; 110,8 độ Kinh Đông. Sức gió mạnh nhất vùng gần tâm bão mạnh cấp 16 (184-201 km/h), giật trên cấp 17.",
      "Dự báo khoảng chiều tối ngày 07/9, bão đi vào đất liền các tỉnh Quảng Ninh - Hải Phòng với sức gió mạnh cấp 12-13 (118-149 km/h), giật cấp 15.",
      "Từ ngày 07/9 đến ngày 09/9, ở Quảng Ninh và Hải Phòng có mưa rất to với lượng mưa phổ biến 200-350 mm, có nơi trên 400 mm; Thái Bình có mưa to với lượng mưa phổ biến 150-250 mm.",
      "Cấp độ rủi ro thiên tai do bão: cấp 4 trên đất liền ven biển Quảng Ninh, Hải Phòng; cấp 3 tại Thái Bình.",
    ].join("\n"),
  },
  {
    id: "bulletin-yagi-3",
    issuedAt: "2024-09-07T05:00:00+07:00",
    issuer: ISSUER,
    language: "vi",
    simulated: true,
    text: [
      "TIN BÃO KHẨN CẤP (CƠN BÃO SỐ 3 - YAGI), TIN PHÁT LÚC 05 GIỜ",
      "Hồi 04 giờ ngày 07/9, vị trí tâm bão ở vào khoảng 20,6 độ Vĩ Bắc; 108,4 độ Kinh Đông, cách Quảng Ninh khoảng 190 km về phía Đông Đông Nam. Sức gió mạnh nhất vùng gần tâm bão mạnh cấp 15 (167-183 km/h), giật trên cấp 17.",
      "Trưa và chiều nay (07/9), bão đi vào vùng biển ven bờ Quảng Ninh - Hải Phòng, sau đó đi sâu vào đất liền các tỉnh Đông Bắc Bộ.",
      "Mưa lớn diện rộng có thể gây lũ quét, sạt lở đất ở vùng núi và ngập úng tại vùng trũng thấp ở Quảng Ninh, Hải Phòng, Thái Bình.",
      "Cấp độ rủi ro thiên tai do bão: cấp 4.",
    ].join("\n"),
  },
];

export const yagi: Scenario = {
  id: "yagi-2024",
  name: "Typhoon Yagi, September 2024",
  description:
    "Replay of Typhoon Yagi reaching northern Vietnam. Forecasts, bulletins, partners and households are simulated.",
  startsAt: "2024-09-04T18:00:00+07:00",
  provinces: PROVINCES,
  partners: PARTNERS,
  households: HOUSEHOLDS,
  forecast: FORECAST,
  bulletins: BULLETINS,
  rules: [
    {
      id: "rule-rain-150-v1",
      key: "rule-rain-150",
      version: 1,
      sourceSentence:
        "Send 20 US dollars to each registered household in a province when the forecast made up to 48 hours ahead shows at least 150 mm of rain in 24 hours.",
      metric: "rain_24h_mm",
      threshold: 150,
      maxLeadHours: 48,
      provinceIds: PROVINCES.map((p) => p.id),
      amountPerHouseholdCents: 2000,
      createdAt: "2024-06-28T09:00:00+07:00",
      lockedAt: "2024-06-30T17:00:00+07:00",
      lockedBy: "Demo organizer (fixture)",
    },
  ],
};
