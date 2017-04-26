module powerbi.extensibility.visual {
    import DataViewObjects = powerbi.extensibility.utils.dataview.DataViewObjects;
    import DataViewObjectPropertyIdentifier = powerbi.DataViewObjectPropertyIdentifier;
    import valueFormatter = powerbi.extensibility.utils.formatting.valueFormatter;
    import tooltip = powerbi.extensibility.utils.tooltip;
    import svgUtils = powerbi.extensibility.utils.svg;

    const colorSelector = { objectName: "colorSelector", propertyName: "fill" };
    const enableImagesSelector = { objectName: "enableImages", propertyName: "show" };
    const generalViewOpacitySelector = { objectName: "generalView", propertyName: "opacity" };

    interface ChartDataPoint {
        value: number;
        category: string;
        color: string;
        imageUrl?: string;
        selectionId: ISelectionId;
        percentage: number;
    }

    interface Settings {
        enableImages: {
            show: boolean;
        };
        generalView: {
            opacity: number;
        };
    }

    interface ChartViewModel {
        dataPoints: ChartDataPoint[];
        dataMax: number;
        dataMin: number;
        hasImageUrls: boolean;
        settings: Settings;
    }

    const defaultSettings = {
        enableImages: {
            show: true
        },
        generalView: {
            opacity: 100
        }
    };

    const emptyViewModel = {
        dataPoints: [],
        dataMax: 0,
        dataMin: 1,
        hasImageUrls: false,
        settings: defaultSettings
    };

    function visualTransform(options: VisualUpdateOptions, host: IVisualHost) {
        const dataViews = options.dataViews;

        if (!dataViews
            || !dataViews[0]
            || !dataViews[0].categorical
            || !dataViews[0].categorical.categories
            || !dataViews[0].categorical.categories[0]) {
            return emptyViewModel;
        }

        const categorical = dataViews[0].categorical;
        const category = categorical.categories[0];
        const hasValues = !!(categorical.values && categorical.values[0]);
        const imageUrlColumns = dataViews[0].metadata.columns.filter(c => c && c.type && c.type.misc && c.type.misc.imageUrl);
        const hasImageUrls = imageUrlColumns.length > 0;

        const columnCount = category.values.length;
        const dataPoints: ChartDataPoint[] = [];

        let colorPalette: IColorPalette = host.colorPalette;
        let objects = dataViews[0].metadata.objects;
        const settings = {
            enableImages: {
                show: hasImageUrls && DataViewObjects.getValue<boolean>(objects, enableImagesSelector, defaultSettings.enableImages.show)
            },
            generalView: {
                opacity: DataViewObjects.getValue<number>(objects, generalViewOpacitySelector, defaultSettings.generalView.opacity),
            }
        };

        let dataMax: number | undefined = undefined;
        let dataMin: number | undefined = undefined;
        for (let i = 0; i < columnCount; i++) {
            let value: number;
            let url: string | undefined;
            let selectionId: ISelectionId;
            const name = category.values[i] + "";

            if (hasValues) {
                if (hasImageUrls) {
                    const column = categorical.values[i];
                    url = column.source.groupName as string;
                    value = column.values[i] as number;
                } else {
                    const column = categorical.values[0];
                    value = column.values[i] as number;
                    url = undefined;
                }
            }
            else {
                url = undefined;
                value = 0;
            }

            const defaultColor = colorPalette.getColor(name).value;

            if (dataMax === undefined) {
                dataMax = value;
            } else if (value > dataMax) {
                dataMax = value;
            }
            if (dataMin === undefined) {
                dataMin = value;
            } else if (value < dataMin) {
                dataMin = value;
            }

            const color = DataViewObjects.getFillColor(objects, colorSelector, defaultColor);

            dataPoints.push({
                category: name,
                value: value,
                color: color,
                imageUrl: url,
                percentage: 0,
                selectionId: host.createSelectionIdBuilder()
                    .withCategory(category, i)
                    .createSelectionId()
            });
        }

        const range = dataMax - dataMin;
        const min = dataMin - (range * 0.1);
        let dataSum = 0;
        for (let i = 0; i < dataPoints.length; i++) {
            dataPoints[i].value = dataPoints[i].value - min;
            dataSum += dataPoints[i].value;
        }
        for (let i = 0; i < dataPoints.length; i++) {
            dataPoints[i].percentage = dataPoints[i].value / dataSum;
        }

        return {
            dataPoints: dataPoints,
            dataMax: dataMax,
            dataMin: dataMin,
            hasImageUrls: hasImageUrls,
            settings: settings
        };

    }

    export class Visual implements IVisual {
        private readonly formatter: utils.formatting.IValueFormatter;
        private readonly svg: d3.Selection<SVGElement>;
        private readonly host: IVisualHost;
        private readonly mainGraphics: d3.Selection<SVGElement>;
        private readonly selectionManager: ISelectionManager;
        private readonly defs: d3.Selection<SVGDefsElement>;
        private readonly tooltipServiceWrapper: tooltip.ITooltipServiceWrapper;
        private settings: Settings;
        private dataPoints: ChartDataPoint[];

        static Config = {
            solidOpacity: 1,
            transparentOpacity: 0.5
        };

        constructor(options: VisualConstructorOptions) {
            try {
                this.formatter = valueFormatter.create({ value: 0, precision: 3 });
                this.selectionManager = options.host.createSelectionManager();
                this.host = options.host;
                this.tooltipServiceWrapper = tooltip.createTooltipServiceWrapper(this.host.tooltipService, options.element);
                const svg = this.svg = d3.select(options.element)
                    .append("svg")
                    .classed("imagePieChart", true);
                const mainGraphics = this.mainGraphics = svg.append("g");
                this.defs = svg.append("defs");
            }
            catch (ex) {
                console.warn(ex);
            }

        }

        public update(options: VisualUpdateOptions) {
            try {
                const viewModel = visualTransform(options, this.host);
                const settings = this.settings = viewModel.settings;
                const dataPoints = this.dataPoints = viewModel.dataPoints;

                const width = options.viewport.width;
                const height = options.viewport.height;
                const radius = Math.min(width, height) / 2;

                this.svg.attr({
                    width: width,
                    height: height
                });

                const useImages = viewModel.hasImageUrls && settings.enableImages.show;


                if (useImages) {
                    const patterns = this.defs.selectAll("pattern").data(viewModel.dataPoints);
                    const imageWidth = radius;
                    const imageHeight = (imageWidth / 1024) * 768;
                    patterns.enter()
                        .append("pattern")
                        .attr("patternUnits", "userSpaceOnUse")
                        .attr("width", imageWidth)
                        .attr("height", imageHeight)
                        .attr("id", d => `bg-${d.category}`)
                        .append("image")
                        .attr("xlink:href", d => d.imageUrl)
                        .attr("width", imageWidth)
                        .attr("height", imageHeight);

                    patterns.exit()
                        .remove();
                }

                const g = this.mainGraphics
                    .attr("transform", svgUtils.translate(width / 2, height / 2));

                const pie = d3.layout.pie<ChartDataPoint>()
                    .sort(null)
                    .value(d => d.percentage);


                const path = d3.svg.arc<any>()
                    .outerRadius(radius)
                    .innerRadius(0);

                const arcs = g.selectAll(".arc")
                    .data(pie(viewModel.dataPoints));

                arcs
                    .enter()
                    .append("path")
                    .classed("arc", true);

                const opacity = viewModel.settings.generalView.opacity / 100;
                arcs.attr("d", path)
                    .attr("fill-opacity", opacity);

                if (useImages) {
                    arcs
                        .attr("fill", d => `url(#bg-${d.data.category})`);
                } else {
                    arcs
                        .attr("fill", d => d.data.color);

                }

                this.tooltipServiceWrapper.addTooltip<d3.layout.pie.Arc<ChartDataPoint>>(this.mainGraphics.selectAll(".arc"),
                    tooltipEvent => this.getTooltipData(tooltipEvent.data.data),
                    tooltipEvent => tooltipEvent.data.data.selectionId);

                const selectionManager = this.selectionManager;
                const allowInteractions = this.host.allowInteractions;

                // This must be an anonymous function instead of a lambda because
                // d3 uses 'this' as the reference to the element that was clicked.
                arcs.on("click", function (d) {
                    // Allow selection only if the visual is rendered in a view that supports interactivity (e.g. Report)
                    if (allowInteractions) {
                        selectionManager.select(d.data.selectionId).then((ids: ISelectionId[]) => {
                            arcs.attr({
                                "fill-opacity": ids.length > 0 ? opacity * Visual.Config.transparentOpacity : opacity
                            });

                            d3.select(this).attr({
                                "fill-opacity": Visual.Config.solidOpacity
                            });
                        });

                        (<Event>d3.event).stopPropagation();
                    }
                });

            }
            catch (ex) {
                console.warn(ex);
                throw ex;
            }
        }

        private getTooltipData(point: ChartDataPoint) {
            return [{
                displayName: point.category,
                value: this.formatter.format(point.value),
                color: point.color
            }];
        }

        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
            try {
                let objectName = options.objectName;
                let objectEnumeration: VisualObjectInstance[] = [];

                switch (objectName) {
                    case "enableImages":
                        objectEnumeration.push({
                            objectName: objectName,
                            properties: {
                                show: this.settings.enableImages.show,
                            },
                            selector: null
                        });
                        break;

                    case "colorSelector":
                        for (let dataPoint of this.dataPoints) {
                            objectEnumeration.push({
                                objectName: objectName,
                                displayName: dataPoint.category,
                                properties: {
                                    fill: {
                                        solid: {
                                            color: dataPoint.color
                                        }
                                    }
                                },
                                selector: dataPoint.selectionId
                            });
                        }
                        break;

                    case "generalView":
                        objectEnumeration.push({
                            objectName: objectName,
                            properties: {
                                opacity: this.settings.generalView.opacity,
                            },
                            validValues: {
                                opacity: {
                                    numberRange: {
                                        min: 10,
                                        max: 100
                                    }
                                }
                            },
                            selector: null
                        });
                        break;
                }

                return objectEnumeration;
            }
            catch (ex) {
                console.warn(ex);
                throw ex;
            }
        }

    }
}