export type ParcelSource = {
  id: string;
  name: string;
  source_type:
    | "county_parcels"
    | "statewide_parcels"
    | "city_parcels"
    | "state_trust_parcels"
    | "plss"
    | "public_land"
    | "pseudo_grid";
  state_code?: string;
  county?: string;
  country: "US";
  priority: number;
  is_true_parcel: boolean;
  is_public_land?: boolean | null;
  license_note: string;
  access_method:
    | "arcgis_feature_service"
    | "arcgis_map_service"
    | "download_file"
    | "manual_file"
    | "api";
  url: string;
  layer_id?: number;
  format?: "geojson" | "shapefile_zip" | "file_geodatabase" | "arcgis_json";
  enabled_by_default: boolean;
  max_records_per_batch?: number;
  status?: "ready" | "needs_url_discovery";
  fields?: {
    id?: string[];
    apn?: string[];
    county?: string[];
    owner?: string[];
    acres?: string[];
  };
};

const DEFAULT_ID_FIELDS = ["OBJECTID", "OBJECTID_1", "FID", "GlobalID", "PARCEL_ID"];
const DEFAULT_APN_FIELDS = ["APN", "PARCELNO", "PARCEL_NUM", "PIN", "TAXPARCELID"];
const DEFAULT_OWNER_FIELDS = ["OWNER_NAME", "OWNER", "OWNERNME1", "OWNER1"];
const DEFAULT_ACRES_FIELDS = ["ACRES", "GIS_ACRES", "AREA_ACRES", "Shape_Area"];

export const PARCEL_SOURCES: ParcelSource[] = [
  {
    id: "blm_natl_plss",
    name: "BLM National PLSS CadNSDI",
    source_type: "plss",
    state_code: "US",
    country: "US",
    priority: 30,
    is_true_parcel: false,
    is_public_land: true,
    license_note:
      "Federal cadastral PLSS section/aliquot fallback for research. Not an assessor parcel dataset. Review BLM source terms before any production or commercial use.",
    access_method: "arcgis_map_service",
    url: "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/1",
    layer_id: 1,
    format: "arcgis_json",
    enabled_by_default: true,
    max_records_per_batch: 1000,
    fields: { id: [...DEFAULT_ID_FIELDS], county: ["ADMIN_COUNTY", "COUNTY"], acres: ["ACRES", "Shape_Area"] },
  },
  {
    id: "az_state_trust_parcels",
    name: "Arizona State Trust Parcels",
    source_type: "state_trust_parcels",
    state_code: "AZ",
    country: "US",
    priority: 70,
    is_true_parcel: true,
    is_public_land: true,
    license_note:
      "Arizona State Land Department parcel access for research use. Verify state licensing and redistribution terms before production or commercial use.",
    access_method: "arcgis_feature_service",
    url: "https://land.az.gov/arcgis/rest/services/StateTrustLand/MapServer/0",
    layer_id: 0,
    format: "arcgis_json",
    enabled_by_default: true,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: ["PARCEL_ID", "PARCELID"], owner: ["OWNER", "OWNER_NAME"], acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "az_maricopa_parcels",
    name: "Maricopa County Parcels",
    source_type: "county_parcels",
    state_code: "AZ",
    county: "Maricopa",
    country: "US",
    priority: 100,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Maricopa County Assessor parcel geometry for public/research access. County source terms still control downstream use and any commercial deployment.",
    access_method: "arcgis_map_service",
    url: "https://gisrest.maricopa.gov/arcgis/rest/services/Assessor/PublicParcels/MapServer/0",
    layer_id: 0,
    format: "arcgis_json",
    enabled_by_default: true,
    max_records_per_batch: 1000,
    fields: { id: [...DEFAULT_ID_FIELDS], apn: ["APN"], county: ["COUNTY", "SITUS_COUNTY"], owner: ["OWNER_NAME"], acres: ["Shape_Area", "ACRES"] },
  },
  {
    id: "az_pima_parcels",
    name: "Pima County Parcels",
    source_type: "county_parcels",
    state_code: "AZ",
    county: "Pima",
    country: "US",
    priority: 100,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Pima County parcel source is intended for research ingestion only until licensing and service limits are reviewed for broader use.",
    access_method: "arcgis_map_service",
    url: "https://gisopendata.pima.gov/datasets/parcels",
    enabled_by_default: true,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: DEFAULT_APN_FIELDS, owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "az_pinal_parcels",
    name: "Pinal County Parcels",
    source_type: "county_parcels",
    state_code: "AZ",
    county: "Pinal",
    country: "US",
    priority: 100,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Pinal County parcel source is used as a public-access research feed; confirm county licensing before production or commercial use.",
    access_method: "arcgis_map_service",
    url: "https://gis.pinal.gov/arcgis/rest/services/Parcels/MapServer/0",
    layer_id: 0,
    format: "arcgis_json",
    enabled_by_default: true,
    max_records_per_batch: 1000,
    fields: { id: [...DEFAULT_ID_FIELDS], apn: DEFAULT_APN_FIELDS, owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "az_phoenix_parcels",
    name: "Phoenix City Parcels",
    source_type: "city_parcels",
    state_code: "AZ",
    county: "Maricopa",
    country: "US",
    priority: 80,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "City of Phoenix parcel-style geometry is included for research coverage only; confirm municipal licensing and authoritative status before broader use.",
    access_method: "arcgis_map_service",
    url: "https://opendata.arcgis.com/datasets/phoenix::parcels",
    enabled_by_default: false,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: DEFAULT_APN_FIELDS, owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "fl_statewide_parcels",
    name: "Florida Statewide Parcels",
    source_type: "statewide_parcels",
    state_code: "FL",
    country: "US",
    priority: 90,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Florida statewide parcel aggregation is suitable for research workflows, but statewide and county licensing must be reviewed before any commercial deployment.",
    access_method: "arcgis_map_service",
    url: "https://services.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/Florida_Parcels/FeatureServer/0",
    layer_id: 0,
    format: "arcgis_json",
    enabled_by_default: true,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: DEFAULT_APN_FIELDS, owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "wi_statewide_parcels",
    name: "Wisconsin Statewide Parcel Map",
    source_type: "statewide_parcels",
    state_code: "WI",
    country: "US",
    priority: 90,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Wisconsin statewide parcel map is broadly accessible for research. Commercial redistribution and derived-product rights still require source review.",
    access_method: "download_file",
    url: "https://www.sco.wisc.edu/parcels/",
    format: "file_geodatabase",
    enabled_by_default: true,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: ["PARCELID", "PIN", "APN"], owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "nc_statewide_parcels",
    name: "North Carolina Parcels",
    source_type: "statewide_parcels",
    state_code: "NC",
    country: "US",
    priority: 90,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "North Carolina parcel aggregation is a research-access source. Confirm NC OneMap and county licensing before production or commercial use.",
    access_method: "arcgis_map_service",
    url: "https://services.nconemap.gov/secure/rest/services/Cadastral/Parcels/MapServer/0",
    layer_id: 0,
    format: "arcgis_json",
    enabled_by_default: true,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: DEFAULT_APN_FIELDS, county: ["COUNTY", "COUNTYNAME"], owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "ma_property_tax_parcels",
    name: "Massachusetts Property Tax Parcels",
    source_type: "statewide_parcels",
    state_code: "MA",
    country: "US",
    priority: 90,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Massachusetts property tax parcel data is aggregated from public GIS sources for research use. Commercial use requires per-source review.",
    access_method: "download_file",
    url: "https://www.mass.gov/info-details/massgis-data-property-tax-parcels",
    format: "shapefile_zip",
    enabled_by_default: true,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: ["LOC_ID", "PARCEL_ID", "MAP_PAR_ID", "APN"], owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "ne_statewide_parcels",
    name: "Nebraska Statewide Parcels",
    source_type: "statewide_parcels",
    state_code: "NE",
    country: "US",
    priority: 90,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Nebraska statewide parcel feed is included for research coverage. Verify state and county terms before any production or commercial use.",
    access_method: "arcgis_map_service",
    url: "https://gis.ne.gov/arcgis/rest/services/Parcels/MapServer/0",
    enabled_by_default: true,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: DEFAULT_APN_FIELDS, owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "or_taxlots",
    name: "Oregon Taxlots",
    source_type: "statewide_parcels",
    state_code: "OR",
    country: "US",
    priority: 90,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Oregon tax lot or statewide parcel access is treated as research-grade only until state licensing, availability, and redistribution terms are verified.",
    access_method: "download_file",
    url: "https://www.oregon.gov/geo/Pages/index.aspx",
    format: "file_geodatabase",
    enabled_by_default: false,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: DEFAULT_APN_FIELDS, owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
  {
    id: "wa_current_parcels",
    name: "Washington Current Parcels",
    source_type: "statewide_parcels",
    state_code: "WA",
    country: "US",
    priority: 90,
    is_true_parcel: true,
    is_public_land: false,
    license_note:
      "Washington parcel access is configured for research only. Verify state/county licensing, freshness, and service terms before production use.",
    access_method: "download_file",
    url: "https://geo.wa.gov/datasets/wa-geospatial-open-data-parcels",
    format: "file_geodatabase",
    enabled_by_default: false,
    status: "needs_url_discovery",
    fields: { id: [...DEFAULT_ID_FIELDS], apn: DEFAULT_APN_FIELDS, owner: DEFAULT_OWNER_FIELDS, acres: DEFAULT_ACRES_FIELDS },
  },
];

export const PARCEL_SOURCES_BY_ID = new Map(PARCEL_SOURCES.map((source) => [source.id, source]));

export function getParcelSource(sourceId: string): ParcelSource | undefined {
  return PARCEL_SOURCES_BY_ID.get(sourceId);
}

export function listEnabledParcelSources(): ParcelSource[] {
  return PARCEL_SOURCES.filter((source) => source.enabled_by_default);
}
