import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import FeatureSet from "@arcgis/core/rest/support/FeatureSet";
import Expand from "@arcgis/core/widgets/Expand";
import Editor from "@arcgis/core/widgets/Editor";
import * as rendererJsonUtils from "@arcgis/core/renderers/support/jsonUtils";
import * as symbolJsonUtils from "@arcgis/core/symbols/support/jsonUtils";

//Global variables holding handles for current project directories
var projectDirectoryHandle;
var projectFeaturesDirectoryHandle;
var projectSymbolsDirectoryHandle;
var projectRenderersDirectoryHandle;
var projectLayersDirectoryHandle;

//Global variables holding arrays of current project objects
var projectFeatures = [];
var projectLayers = [];
var projectRenderers = [];
var projectSymbols = [];

class ProjectFileAbstract {
  /**
   * Root abstract class that handles the implementation of project files including layers, features, renderers and 
   * symbols. The constructor should not be called directly, insted the create builder method should be used.
   * @param {FileHandle} handle File handle from file access system API that is used to construct the object.
   * @param {Object} fileParams Object containing the JSON object, file and fileText references derived from the 
   * handle. 
   */
  constructor (handle, fileParams) {
    this.handle = handle;
    this.name = this.handle.name;
    this.object = fileParams.object;
    this.file = fileParams.file;
    this.fileText = fileParams.fileText;
  }
  /**
   * Method that uses input handle to derive fileParams object.
   * @param {FileHandle} handle 
   * @returns {Object} fileParams object that will be used in the object constructor.
   */
  static async getFileParams(handle) {
    const file = await handle.getFile();
    const fileText =  await file.text();
    const object = await JSON.parse( fileText );
    return {file: file, fileText: fileText, object: object};
  }
  /**
   * Builder method  used to contructnew objects of this class. This should be called using await to ensure that 
   * properties will resolved once they are called.
   * @param {FileHandle} handle 
   * @returns {ProjectFileAbstract} new instance of this class.
   */
  static async create(handle) {
    const fileParams = await this.getFileParams(handle);

    const newObject = await new this(handle, fileParams);

    return newObject;
  }
}

class ProjectLayer extends ProjectFileAbstract {
  /**
   * Class that represents a feature layer within the project. The source file is derived from custom JSON syntax that
   * describes the features used in addition to the renderer and options involved in the feature layer.
   * @param {FileHandle} layerHandle inherited
   * @param {Object} fileParams inherited
   * @param {ProjectFeatures} sourceFeatures The project feature representation that will be rendered by this layer.
   * @param {FeatureSet} sourceFS FeatureSet derived from the sourceFeatures object.
   * @param {ProjectRenderer} renderer The renderer that will be used to symbolize features in this layer.
   * @param {FeatureLayer} featureLayer The actual ESRI feature layer class created by this layer.
   */
  constructor (layerHandle, fileParams, sourceFeatures, sourceFS, renderer, featureLayer) {
    super(layerHandle, fileParams);

    this.sourceFeature =  sourceFeatures;
    this.sourceFS = sourceFS;
    this.renderer = renderer;

    this.featureLayer = featureLayer;

    //Create listener for this layer which will trigger a save event for the client side files whenver the layer is
    //edited within the application.
    //TODO: This save method is fairly ineffectient as it copies and rewrites the entire JSON file for every feature /////edit. A save/discard edits widget should be implemented in addition to more targeted file editing.
    this.featureLayer.on("edits", async () => {
      this.sourceFS = await featureLayer.queryFeatures();

      const editFeatureWritable = await this.sourceFeature.handle.createWritable();
      await editFeatureWritable.write(JSON.stringify( this.sourceFS.toJSON() ));
      await editFeatureWritable.close();
    });
    
    map.add(this.featureLayer);

    //Ensure the application has a reference to this new object
    projectLayers.push(this);
  }
  /**
   * Builder method used to construct new instances of this class. Should be called by await.
   * @param {FileHandle} handle 
   * @returns {ProjectLayer} New instance of this class.
   */
  static async create(handle) {
    const fileParams = await this.getFileParams(handle);

    //Ensure that features and renderer have been created before using them in constructor.
    let sourceFeatures, sourceFS;
    if (fileParams.object.featureSet) {
      sourceFeatures = await projectFeatures.find(element => element.name == fileParams.object.featureSet);
      sourceFS =  await sourceFeatures.fs;
    }
    let renderer;
    if (fileParams.object.renderer) {
      renderer = await projectRenderers.find(element => element.name == fileParams.object.renderer);
    }

    //TODO: undefined in ternaries here should be replaced by a default. Currently they override the actual default
    const featureLayer = new FeatureLayer({
      source: sourceFeatures ? sourceFeatures.fs.features : undefined,
      fields: sourceFeatures ? sourceFeatures.fs.fields : undefined,
      renderer: renderer ? renderer.rendererObject : undefined,
      editingEnabled:  (fileParams.object.editingEnabled != undefined) ? fileParams.object.editingEnabled : true,
      title: handle.name,
    });

    const newObject = new this(handle, fileParams, sourceFeatures, sourceFS, renderer, featureLayer);

    return newObject;
  }
}

class ProjectFeature extends ProjectFileAbstract {
  /**
   * Class that represents features to be used by layers within the project.
   * @param {FileHandle} featureHandle inherited
   * @param {Object} fileParams inherited
   * @param {FeatureSet} fs Actual ESRI FeatureSet represented by this object.
   */
  constructor (featureHandle, fileParams, fs) {
    super(featureHandle, fileParams);

    this.fs = fs;

    //Ensure that a reference to this new object is retained and locatable.
    projectFeatures.push(this);
  }
  /**
   * Builder method that creates new instance of this class.
   * @param {FileHandle} handle 
   * @returns {ProjectFeature}
   */
  static async create(handle) {
    const fileParams = await this.getFileParams(handle);

    const fs = await FeatureSet.fromJSON(fileParams.object);

    const newObject = await new this(handle, fileParams, fs);

    return newObject;
  }
}

class ProjectRenderer extends ProjectFileAbstract {
  /**
   * Class that represents a renderer to be used by layers within the project.
   * @param {FileHandle} rendererHandle inherited
   * @param {Object} fileParams inherited 
   * @param {Object} parsedObject A copy of fileParams.object, but with symbol file strings replaced by symbol objects 
   * @param {Renderer} rendererObject The actual ESRI renderer object that is represented
   */
  constructor (rendererHandle, fileParams, parsedObject, rendererObject) {
    super(rendererHandle, fileParams);

    this.parsedObject = parsedObject;
    this.rendererObject = rendererObject;

    //Ensure an instance of the class remains with project and is locatable
    projectRenderers.push(this);
  }
  /**
   * Builder method that returns an actual instance of the class. Should be called using await.
   * @param {FileHandle} handle 
   * @returns {ProjectRenderer}
   */
  static async create(handle){
    /**
     * Function responsible for iterating through the object JSON and replacing symbol file strings with actual objects
     * @param {Object} objectToParse 
     * @returns {Object}
     */
    function parseSymbolKeys (objectToParse) {
      for (const key in objectToParse) {
        const value = objectToParse[key];
        const valueType = typeof value;
        if (["symbol", "defaultSymbol"].includes(key)) {
          if ( value != "" && valueType == "string" ) {
            //Find the symbol and add it as an object.
            const newSymbol = projectSymbols.find(element => element.name == value);
            objectToParse[key] = newSymbol.symbolObject.toJSON();
          }
        } else {
          //Keep looking through sub-objects in case symbol is inside of an infos object
          if (typeof value == "object") {
            parseSymbolKeys(value);
          }
        }
      }
      return objectToParse;
    }

    const fileParams = await this.getFileParams(handle);

    //Start iteration to search for symbol file strings inside the renderer object
    const parsedObject = await parseSymbolKeys(fileParams.object);

    //Create the renderer object using the ESRI utils function in order to properly read the renderer type.
    const rendererObject = await rendererJsonUtils.fromJSON(parsedObject);
  
    const newObject = await new this(handle, fileParams, parsedObject, rendererObject);

    return newObject;
  }
}

class ProjectSymbol extends ProjectFileAbstract {
  /**
   * Class that represents symbols that are utilized by features and renderers within the project.
   * @param {FileHandle} symbolHandle inherited 
   * @param {Object} fileParams inherited 
   * @param {Symbol} symbolObject Actual ESRI Symbol object that is being represented.
   */
  constructor (symbolHandle, fileParams, symbolObject) {
    super(symbolHandle, fileParams);

    this.symbolObject = symbolObject;

    //Ensure that a reference to this instance is maintained with the project and is locatable.
    projectSymbols.push(this);
  }
  /**
   * Builder method that is used to construct a new instance of this class. Should be called using await.
   * @param {FileHandle} handle 
   * @returns {ProjectSymbol}
   */
  static async create(handle) {
    const fileParams = await this.getFileParams(handle);

    //Use the utils function to ensure that a symbol of the proper type is returned.
    const symbolObject = symbolJsonUtils.fromJSON(fileParams.object);
 
    const newObject = await new this(handle, fileParams, symbolObject);

    return newObject;
  }
}

/**
 * Function that saves an object as a JSON file using showSaveFilePicker
 * @param Object object to be saved as the contents 
 * @returns {FileHandle} The file handle of the new file that was just saved.
 */
async function saveAsJSON(inputObj, start = undefined) {
  //Open the picker window
  const saveHandle = await window.showSaveFilePicker({
    id: "saveJSON",
    suggestedName: "Unnamed.json",
    types: [{ //ensure file can only be saved as JSON
      description: "JSON File",
      accept: {
        "application/json": [".json"]
      },
    startIn: start,
    }]
  });
  const saveWritable = await saveHandle.createWritable();
  await saveWritable.write(JSON.stringify(inputObj));
  await saveWritable.close();
  return saveHandle;
}

/**
 * Gets the JSON notation of a feature layer from a url and saves it as a client file
 */
function downloadFeatureAsJSON() {
  const dlLoc = document.getElementById("download-feature-input").value;
  const dlLayer = new FeatureLayer({ url: dlLoc});
  const dlFS = dlLayer.queryFeatures();
  dlFS.then( (fs) => {
    const dlJSON = fs.toJSON();
    saveAsJSON(dlJSON);
  });
}

/**
 * Function responsible for selecting a project direcotry, ensuring that it has the appropriate structure and the then
 * adding any contents to the map.
 */
async function connectProjectFolder() {
  //Allow the user to select a directory (requests read access)
  projectDirectoryHandle = await window.showDirectoryPicker();
  document.getElementById("connect-folder-button").innerHTML =  `connected to: ${projectDirectoryHandle.name}`;

  //Creates the directory structure if  non-existant and build references (requests write access to entire project 
  //directory)
  projectFeaturesDirectoryHandle = await projectDirectoryHandle.getDirectoryHandle("Features", {create: true});
  projectRenderersDirectoryHandle = await projectDirectoryHandle.getDirectoryHandle("Renderers", {create: true});
  projectSymbolsDirectoryHandle = await projectDirectoryHandle.getDirectoryHandle("Symbols", {create: true});
  projectLayersDirectoryHandle = await projectDirectoryHandle.getDirectoryHandle("Layers", {create: true});

  //Read contents of each directory, adding any files to the project.
  //Order is impportant to ensure that appropriate objects are created before being called.
  for await (const entry of projectSymbolsDirectoryHandle.values()) {
    if (entry.kind == "file") {
      const entryHandle = await projectSymbolsDirectoryHandle.getFileHandle(entry.name);
      await ProjectSymbol.create(entryHandle);
    }
  }

  for await (const entry of projectRenderersDirectoryHandle.values()) {
    if (entry.kind == "file") {
      const entryHandle = await projectRenderersDirectoryHandle.getFileHandle(entry.name);
      await ProjectRenderer.create(entryHandle);
    }
  }

  for await (const entry of projectFeaturesDirectoryHandle.values()) {
    if (entry.kind == "file") {
      const entryHandle = await projectFeaturesDirectoryHandle.getFileHandle(entry.name);
      await ProjectFeature.create(entryHandle);
    }
  }

  for await (const entry of projectLayersDirectoryHandle.values()) {
    if (entry.kind == "file") {
      const entryHandle = await projectLayersDirectoryHandle.getFileHandle(entry.name);
      await ProjectLayer.create(entryHandle);
    }
  }

  //Pan the map to the extents of all features in the project
  const allFeatures = [];
  projectLayers.forEach( (layer) => {
    allFeatures.push(layer.sourceFS.features);
  });
  await view.goTo( allFeatures );
}

/**
 * Function that adds individual files to the project. The files are selected by users, if they exist outside the 
 * project structure they will be added.
 * TODO: Add logic to check if the same file is already in the project to avoid duplication.
 * @param {string} fileType Simple name for the type of file being added to the project.
 */
async function addFileToProject(fileType) {
  //Get FileHandle from user input
  let inputFileHandle;
  [inputFileHandle] = await window.showOpenFilePicker();
  const inputFile = await inputFileHandle.getFile();
  const fileText = await inputFile.text();

  //Create a handle inside of the project directory to copy the contents of the input file to it.
  let newFileHandle;
  switch ( fileType ) {
    case "feature":
      newFileHandle = await projectFeaturesDirectoryHandle.getFileHandle(inputFileHandle.name, {create: true});
      break;
    case "renderer":
      newFileHandle = await projectRenderersDirectoryHandle.getFileHandle(inputFileHandle.name, {create: true});
      break;
    case "symbol":
      newFileHandle = await projectSymbolsDirectoryHandle.getFileHandle(inputFileHandle.name, {create: true});
      break;
    case "layer":
      newFileHandle = await projectLayersDirectoryHandle.getFileHandle(inputFileHandle.name, {create: true});
      break;
  }
  
  //Copy contents of input handle as contents of new handle
  const newFeatureWritable = await newFileHandle.createWritable();
  await newFeatureWritable.write(fileText);
  await newFeatureWritable.close();


  //Create an instance of the input file for the current project.
  switch ( fileType ) {
    case "feature":
      await new ProjectFeature.create(newFileHandle);
      break;
    case "renderer":
      await new ProjectRenderer.create(newFileHandle);
      break;
    case "symbol":
      await new ProjectSymbol.create(newFileHandle);
      break;
    case "layer":
      var newLayer = await ProjectLayer.create(newFileHandle);
      view.goTo(newLayer.sourceFS.features);
      break;
  }
}

/**
 * Open the window used to create new layer files.
 */
function openCreateLayerModal() {
  layerManagementWidget.expanded = false; //Close the widget that opens the window so it won't be in the way.

  //Create the list of features and renderers that available to create a layer from.
  const featureOptions = projectFeatures.map( (feature) => {
    const elem = document.createElement("option");
    elem.value = feature.name;
    elem.text = feature.name;
    return elem;
  });

  const layerSelect = document.getElementById("layer-feature-select");
  layerSelect.replaceChildren(...featureOptions);
  layerSelect.appendChild(new Option("None", false));

  const rendererOptions = projectRenderers.map( ( renderer ) => {
    const elem = document.createElement("option");
    elem.value = renderer.name;
    elem.text = renderer.name;
    return elem;});

  const rendererSelect = document.getElementById("layer-renderer-select");
  rendererSelect.replaceChildren(...rendererOptions);
  rendererSelect.appendChild(new Option("None", false));

  //Open the window
  document.getElementById("create-layer-modal").style.display = "block";
}

/**
 * Function that takes user input from layer creation window and builds a new JSON Layer file and adds it to the 
 * project.
 */
async function createNewLayer() {
  const layerObject = {
    featureSet: document.getElementById("layer-feature-select").value,
    renderer: document.getElementById("layer-renderer-select").value,
    editingEnabled: (document.getElementById("layer-edit-checkbox").value == "on") ? true : false,
  };

  //Ask the user where to save, start them in the current project layers directory if possible.
  const newLayerHandle = await saveAsJSON(layerObject, projectLayersDirectoryHandle);

  const newLayer = await ProjectLayer.create(newLayerHandle);
  if (newLayer.featureLayer.sourceFS) {
    view.goTo(newLayer.featureLayer.sourceFS.features);
  }
  document.getElementById("create-layer-modal").style.display = "none";
}

const map = new Map({
  basemap: "osm"
});

const view = new MapView({
  container: document.getElementById("viewDiv"),
  map: map,
  zoom: 3,
  center: [0,0] // longitude, latitude
});

//Define and add UI elements
const connectFolderWidget = new Expand({
  view: view,
  content: document.getElementById("connect-widget"),
  expanded: true,
  expandIconClass: "esri-icon-link",
  expandTooltip: "Connect Project Folder",
  group: "bottom-left"
});

const addFilesWidget = new Expand({
  view: view,
  content: document.getElementById("add-widget"),
  expandIconClass: "esri-icon-add-attachment",
  expandTooltip: "Add files to project",
  group: "bottom-left"
});

const downloadWidget = new Expand({
  view: view,
  content: document.getElementById("download-widget"),
  expandIconClass: "esri-icon-download",
  expandTooltip: "Download Features",
  group: "bottom-left"
});

const layerManagementWidget = new Expand({
  view: view,
  content: document.getElementById("layer-management-widget"),
  expandIconClass: "esri-icon-layers",
  expandTooltip: "Create Layer",
  group: "bottom-left"
});

view.ui.add([connectFolderWidget, addFilesWidget, downloadWidget, layerManagementWidget], "bottom-left");

const editorWidget = new Editor({
  view: view,
});

const editorExpand = new Expand({
  view: view,
  content: editorWidget,
  expandIconClass: "esri-icon-edit",
  expandTooltip: "Edit Features",
  group: "top-right"
});

view.ui.add(editorExpand, "top-right");

view.ui.add(document.getElementById("create-layer-modal"), "manual");

//Attach event listeners connecting buttons to their functions.
document.getElementById("connect-folder-button").addEventListener("click", connectProjectFolder);
document.getElementById("add-feature-button").addEventListener("click", () => addFileToProject("feature"));
document.getElementById("add-symbol-button").addEventListener("click", () => addFileToProject("symbol"));
document.getElementById("add-renderer-button").addEventListener("click",() => addFileToProject("renderer") );
document.getElementById("add-layer-button").addEventListener("click",() => addFileToProject("layer") );
document.getElementById("download-layer-button").addEventListener("click", downloadFeatureAsJSON);
document.getElementById("create-layer-button").addEventListener("click", openCreateLayerModal);
document.getElementById("save-layer-button").addEventListener("click",createNewLayer);
document.getElementById("layer-modal-x").addEventListener("click", () => {
  document.getElementById("create-layer-modal").style.display = "none";}); //Close the window if X is pressed