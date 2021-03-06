using System;
using AlphaTab.Audio.Synth;
using AlphaTab.Collections;
using AlphaTab.Haxe;
using AlphaTab.Haxe.Js;
using AlphaTab.Haxe.Js.Html;
using AlphaTab.Importer;
using AlphaTab.Model;
using AlphaTab.Platform;
using AlphaTab.Platform.JavaScript;
using AlphaTab.Platform.Model;
using AlphaTab.Platform.Svg;
using AlphaTab.Rendering;
using AlphaTab.Rendering.Utils;
using AlphaTab.Util;
using AlphaTab.Utils;
using Haxe;
using Haxe.Js.Html;
using Phase;

namespace AlphaTab.UI
{
    internal class BrowserUiFacade : IUiFacade<object>
    {
        private event Action _rootContainerBecameVisible;

        private FastDictionary<string, FontLoadingChecker> _fontCheckers;

        private AlphaTabApi<object> _api;
        private string _contents;
        private string _file;
        private int _visibilityCheckIntervalId;
        private int _visibilityCheckInterval;
        private int _totalResultCount;
        private int[] _initialTrackIndexes;

        public int ResizeThrottle => 10;

        public IContainer RootContainer { get; }
        public bool AreWorkersSupported { get; }

        public bool CanRender => AreAllFontsLoaded();

        private bool AreAllFontsLoaded()
        {
            if (!Environment.BravuraFontChecker.IsFontLoaded)
            {
                return false;
            }

            foreach (var font in _fontCheckers)
            {
                var checker = _fontCheckers[font];
                if (!checker.IsFontLoaded)
                {
                    return false;
                }
            }

            Logger.Debug("Font", "All fonts loaded: " + _fontCheckers.Count);

            return true;
        }

        public event Action CanRenderChanged;

        private void OnFontLoaded(string family)
        {
            FontSizes.GenerateFontLookup(family);

            if (AreAllFontsLoaded())
            {
                var handler = CanRenderChanged;
                if (handler != null)
                {
                    handler();
                }
            }
        }

        public BrowserUiFacade(Element rootElement)
        {
            _fontCheckers = new FastDictionary<string, FontLoadingChecker>();
            rootElement.ClassList.Add("alphaTab");
            RootContainer = new HtmlElementContainer(rootElement);
            var workersUnsupported = !Browser.Window.Member<bool>("Worker");
            AreWorkersSupported = !workersUnsupported;
            Environment.BravuraFontChecker.FontLoaded += OnFontLoaded;
        }

        public IScoreRenderer CreateWorkerRenderer()
        {
            return new AlphaTabWorkerScoreRenderer<object>(_api, _api.Settings);
        }

        public event Action RootContainerBecameVisible
        {
            add
            {
                if (RootContainer.IsVisible)
                {
                    value();
                }
                else
                {
                    _rootContainerBecameVisible += value;
                    if (_visibilityCheckIntervalId == 0)
                    {
                        _visibilityCheckIntervalId = Browser.Window.SetInterval((Action)(() =>
                            {
                                if (_api.Container.IsVisible)
                                {
                                    Browser.Window.ClearInterval(_visibilityCheckIntervalId);
                                    _visibilityCheckIntervalId = 0;

                                    if (_rootContainerBecameVisible != null)
                                    {
                                        _rootContainerBecameVisible();
                                    }

                                    _rootContainerBecameVisible = null;
                                    _visibilityCheckIntervalId = 0;
                                }
                            }),
                            _visibilityCheckInterval);
                    }
                }
            }
            remove => _rootContainerBecameVisible -= value;
        }

        public void Initialize(AlphaTabApi<object> api, object raw)
        {
            _api = api;

            var settings = new Settings();
            settings.FillFromJson(raw);
            var dataAttributes = GetDataAttributes();
            settings.FillFromDataAttributes(dataAttributes);

            if (settings.Notation.NotationMode == NotationMode.SongBook)
            {
                settings.SetSongBookModeSettings();
            }

            api.Settings = settings;
            if (settings.Core.Engine == "default" || settings.Core.Engine == "svg")
            {
                api.Container.Scroll += ShowSvgsInViewPort;
                api.Container.Resize += ShowSvgsInViewPort;
            }

            SetupFontCheckers(settings);

            #region build tracks array

            // get track data to parse
            object tracksData;
            dynamic options = raw;
            if (options != null && options.tracks)
            {
                tracksData = options.tracks;
            }
            else
            {
                if (dataAttributes.ContainsKey("tracks"))
                {
                    tracksData = dataAttributes["tracks"];
                }
                else
                {
                    tracksData = 0;
                }
            }

            _initialTrackIndexes = ParseTracks(tracksData);

            #endregion

            _contents = "";
            var element = ((HtmlElementContainer)api.Container);
            if (dataAttributes.ContainsKey("tex") && element.Element.InnerText.IsTruthy())
            {
                _contents = element.Element.InnerHTML;
                element.Element.InnerHTML = "";
            }

            CreateStyleElement(settings);

            if (options && options.file)
            {
                _file = options.file;
            }
            else if (dataAttributes.ContainsKey("file"))
            {
                _file = (string)dataAttributes["file"];
            }

            _visibilityCheckInterval = 500;
            if (options && options.visibilityCheckInterval)
            {
                _visibilityCheckInterval = options.visibilityCheckInterval;
            }
        }

        private void SetupFontCheckers(Settings settings)
        {
            RegisterFontChecker(settings.Display.Resources.CopyrightFont);
            RegisterFontChecker(settings.Display.Resources.EffectFont);
            RegisterFontChecker(settings.Display.Resources.FingeringFont);
            RegisterFontChecker(settings.Display.Resources.GraceFont);
            RegisterFontChecker(settings.Display.Resources.MarkerFont);
            RegisterFontChecker(settings.Display.Resources.TablatureFont);
            RegisterFontChecker(settings.Display.Resources.TitleFont);
            RegisterFontChecker(settings.Display.Resources.WordsFont);
            RegisterFontChecker(settings.Display.Resources.BarNumberFont);
            RegisterFontChecker(settings.Display.Resources.FretboardNumberFont);
            RegisterFontChecker(settings.Display.Resources.SubTitleFont);
        }

        private void RegisterFontChecker(Font font)
        {
            if (!_fontCheckers.ContainsKey(font.Family))
            {
                var checker = new FontLoadingChecker(font.Family);
                _fontCheckers[font.Family] = checker;
                checker.FontLoaded += OnFontLoaded;
                checker.CheckForFontAvailability();
            }
        }

        public void Destroy()
        {
            ((HtmlElementContainer)RootContainer).Element.InnerHTML = "";
        }

        public IContainer CreateCanvasElement()
        {
            var canvasElement = Browser.Document.CreateElement("div");

            canvasElement.ClassName = "at-surface";
            canvasElement.Style.FontSize = "0";
            canvasElement.Style.Overflow = "hidden";
            canvasElement.Style.LineHeight = "0";

            return new HtmlElementContainer(canvasElement);
        }

        public void TriggerEvent(IContainer container, string name, object details = null, IMouseEventArgs originalEvent = null)
        {
            var element = ((HtmlElementContainer)container).Element;

            name = "alphaTab." + name;
            dynamic e = Browser.Document.CreateEvent("CustomEvent");
            var originalMouseEvent = (originalEvent != null) ? ((BrowserMouseEventArgs)originalEvent).MouseEvent : null;
            e.initCustomEvent(name, false, false, details);
            if (originalMouseEvent != null)
            {
                e.originalEvent = originalMouseEvent;
            }
            element.DispatchEvent(e);

            if (Platform.Platform.JsonExists(Browser.Window, "jQuery"))
            {
                var jquery = Browser.Window.Member<dynamic>("jQuery");

                var args = new FastList<object>();
                args.Add(details);
                if (originalMouseEvent != null)
                {
                    args.Add(originalMouseEvent);
                }

                jquery(element).trigger(name, args.ToArray());
            }
        }

        public bool Load(object data, Action<Score> success, Action<Exception> error)
        {
            if (data is Score)
            {
                success((Score)data);
                return true;
            }

            if (Platform.Platform.InstanceOf<ArrayBuffer>(data))
            {
                success(ScoreLoader.LoadScoreFromBytes(Platform.Platform.ArrayBufferToByteArray((ArrayBuffer)data),
                    _api.Settings));
                return true;
            }

            if (Platform.Platform.InstanceOf<Uint8Array>(data))
            {
                success(ScoreLoader.LoadScoreFromBytes((byte[])data, _api.Settings));
                return true;
            }

            if (Platform.Platform.TypeOf(data) == "string")
            {
                ScoreLoader.LoadScoreAsync((string)data, success, error, _api.Settings);
                return true;
            }

            return false;
        }

        public bool LoadSoundFont(object data)
        {
            if (Platform.Platform.InstanceOf<ArrayBuffer>(data))
            {
                _api.Player.LoadSoundFont(new Uint8Array((ArrayBuffer)data).As<byte[]>());
                return true;
            }

            if (Platform.Platform.InstanceOf<Uint8Array>(data))
            {
                _api.Player.LoadSoundFont(data.As<byte[]>());
                return true;
            }

            if (Platform.Platform.TypeOf(data) == "string")
            {
                ((AlphaTabApi)_api).LoadSoundFontFromUrl((string)data);
                return true;
            }

            return false;
        }

        public void InitialRender()
        {
            _api.Renderer.PreRender += resize => { _totalResultCount = 0; };

            RootContainerBecameVisible += () =>
            {
                // rendering was possibly delayed due to invisible element
                // in this case we need the correct width for autosize
                _api.Renderer.Width = (int)RootContainer.Width;
                _api.Renderer.UpdateSettings(_api.Settings);

                if (!string.IsNullOrEmpty(_contents))
                {
                    _api.Tex(_contents, _initialTrackIndexes);
                    _initialTrackIndexes = null;
                }
                else if (!string.IsNullOrEmpty(_file))
                {
                    ScoreLoader.LoadScoreAsync(_file,
                        s =>
                        {
                            _api.RenderScore(s, _initialTrackIndexes);
                            _initialTrackIndexes = null;
                        },
                        e => { _api.OnError("import", e); },
                        _api.Settings);
                }
            };
        }

        private void ShowSvgsInViewPort()
        {
            var placeholders = ((HtmlElementContainer)_api.CanvasElement).Element.QuerySelectorAll("[data-lazy=true]");
            for (var i = 0; i < placeholders.Length; i++)
            {
                var placeholder = (Element)placeholders.Item(i);
                if (IsElementInViewPort(placeholder))
                {
                    placeholder.OuterHTML = placeholder.Member<HaxeString>("svg");
                }
            }
        }

        public bool IsElementInViewPort(Element element)
        {
            var rect = element.GetBoundingClientRect();
            return
            (
                rect.Top + rect.Height >= 0 && rect.Top <= Browser.Window.InnerHeight &&
                rect.Left + rect.Width >= 0 && rect.Left <= Browser.Window.InnerWidth
            );
        }

        private void CreateStyleElement(Settings settings)
        {
            var elementDocument = ((HtmlElementContainer)_api.Container).Element.OwnerDocument;
            var styleElement = (StyleElement)elementDocument.GetElementById("alphaTabStyle");
            if (styleElement == null)
            {
                var fontDirectory = settings.Core.FontDirectory;
                styleElement = (StyleElement)elementDocument.CreateElement("style");
                styleElement.Id = "alphaTabStyle";
                styleElement.Type = "text/css";
                var css = new StringBuilder();
                css.AppendLine("@font-face {");
                css.AppendLine("    font-family: 'alphaTab';");
                css.AppendLine("     src: url('" + fontDirectory + "Bravura.eot');");
                css.AppendLine("     src: url('" + fontDirectory + "Bravura.eot?#iefix') format('embedded-opentype')");
                css.AppendLine("          , url('" + fontDirectory + "Bravura.woff') format('woff')");
                css.AppendLine("          , url('" + fontDirectory + "Bravura.otf') format('opentype')");
                css.AppendLine("          , url('" + fontDirectory + "Bravura.svg#Bravura') format('svg');");
                css.AppendLine("     font-weight: normal;");
                css.AppendLine("     font-style: normal;");
                css.AppendLine("}");
                css.AppendLine(".at-surface * {");
                css.AppendLine("    cursor: default;");
                css.AppendLine("    vertical-align: top;");
                css.AppendLine("}");
                css.AppendLine(".at {");
                css.AppendLine("     font-family: 'alphaTab';");
                css.AppendLine("     speak: none;");
                css.AppendLine("     font-style: normal;");
                css.AppendLine("     font-weight: normal;");
                css.AppendLine("     font-variant: normal;");
                css.AppendLine("     text-transform: none;");
                css.AppendLine("     line-height: 1;");
                css.AppendLine("     line-height: 1;");
                css.AppendLine("     -webkit-font-smoothing: antialiased;");
                css.AppendLine("     -moz-osx-font-smoothing: grayscale;");
                css.AppendLine("     font-size: 34px;");
                css.AppendLine("     overflow: visible !important;");
                css.AppendLine("}");
                styleElement.InnerHTML = css.ToString();
                elementDocument.GetElementsByTagName("head").Item(0).AppendChild(styleElement);
                Environment.BravuraFontChecker.CheckForFontAvailability();
            }
        }

        public int[] ParseTracks(object tracksData)
        {
            if (tracksData == null)
            {
                return new int[0];
            }

            var tracks = new FastList<int>();

            // decode string
            if (Platform.Platform.TypeOf(tracksData) == "string")
            {
                try
                {
                    if (tracksData == "all")
                    {
                        return new int[]
                        {
                            -1
                        };
                    }

                    tracksData = Json.Parse((string)tracksData);
                }
                catch
                {
                    tracksData = new[]
                    {
                        0
                    };
                }
            }

            // decode array
            if (Platform.Platform.TypeOf(tracksData) == "number")
            {
                tracks.Add((int)tracksData);
            }
            else if (tracksData.HasMember("length"))
            {
                var length = tracksData.Member<int>("length");
                var array = (object[])tracksData;
                for (var i = 0; i < length; i++)
                {
                    var item = array[i];
                    int value;
                    if (Platform.Platform.TypeOf(item) == "number")
                    {
                        value = (int)item;
                    }
                    else if (item.HasMember("index"))
                    {
                        value = item.Member<int>("index");
                    }
                    else
                    {
                        value = Platform.Platform.ParseInt(item.ToString());
                    }

                    if (value >= 0 || value == -1)
                    {
                        tracks.Add(value);
                    }
                }
            }
            else if (tracksData.HasMember("index"))
            {
                tracks.Add(tracksData.Member<int>("index"));
            }

            return tracks.ToArray();
        }

        private FastDictionary<string, object> GetDataAttributes()
        {
            var dataAttributes = new FastDictionary<string, object>();

            var element = ((HtmlElementContainer)_api.Container).Element;

            if (element.Dataset.As<bool>())
            {
                foreach (var key in Platform.Platform.JsonKeys(element.Dataset))
                {
                    var value = element.Dataset.Member<object>(key);
                    try
                    {
                        var stringValue = (string)value;
                        value = Json.Parse(stringValue);
                    }
                    catch
                    {
                        if (value == "")
                        {
                            value = null;
                        }
                    }

                    dataAttributes[key] = value;
                }
            }
            else
            {
                for (var i = 0; i < element.Attributes.Length; i++)
                {
                    var attr = element.Attributes.Item(i);
                    string nodeName = attr.NodeName;
                    if (nodeName.StartsWith("data-"))
                    {
                        var keyParts = nodeName.Substring(5).Split('-');
                        var key = keyParts[0];
                        for (var j = 1; j < keyParts.Length; j++)
                        {
                            key += keyParts[j].Substring(0, 1).ToUpper() + keyParts[j].Substring(1);
                        }

                        object value = attr.NodeValue;
                        try
                        {
                            value = Json.Parse(value.As<HaxeString>());
                        }
                        catch
                        {
                            if (value == "")
                            {
                                value = null;
                            }
                        }

                        dataAttributes[key] = value;
                    }
                }
            }

            return dataAttributes;
        }

        public void BeginAppendRenderResults(RenderFinishedEventArgs renderResult)
        {
            var canvasElement = ((HtmlElementContainer)_api.CanvasElement).Element;

            // null result indicates that the rendering finished
            if (renderResult == null)
            {
                // so we remove elements that might be from a previous render session
                while (canvasElement.ChildElementCount > _totalResultCount)
                {
                    canvasElement.RemoveChild(canvasElement.LastChild);
                }

                // directly show the elements in the viewport once we're done.
                if (_api.Settings.Core.EnableLazyLoading)
                {
                    ShowSvgsInViewPort();
                }
            }
            // NOTE: here we try to replace existing children
            else
            {
                var body = renderResult.RenderResult;
                if (Platform.Platform.TypeOf(body) == "string")
                {
                    Element placeholder;
                    if (_totalResultCount < canvasElement.ChildElementCount)
                    {
                        placeholder = (Element)canvasElement.ChildNodes.Item(_totalResultCount);
                    }
                    else
                    {
                        placeholder = Browser.Document.CreateElement("div");
                        canvasElement.AppendChild(placeholder);
                    }

                    placeholder.Style.Width = renderResult.Width + "px";
                    placeholder.Style.Height = renderResult.Height + "px";
                    placeholder.Style.Display = "inline-block";

                    if (IsElementInViewPort(placeholder) || !_api.Settings.Core.EnableLazyLoading)
                    {
                        var bodyHtml = (string)body;
                        placeholder.OuterHTML = bodyHtml;
                    }
                    else
                    {
                        placeholder.Member("svg", body);
                        placeholder.SetAttribute("data-lazy", "true");
                    }
                }
                else
                {
                    if (_totalResultCount < canvasElement.ChildElementCount)
                    {
                        canvasElement.ReplaceChild(renderResult.RenderResult.As<Node>(),
                            canvasElement.ChildNodes.Item(_totalResultCount));
                    }
                    else
                    {
                        canvasElement.AppendChild(renderResult.RenderResult.As<Node>());
                    }
                }

                _totalResultCount++;
            }
        }

        /// <summary>
        /// This method creates the player. It detects browser compatibility and
        /// initializes a alphaSynth version for the client.
        ///
        /// Compatibility:
        ///   If a browser supports WebWorkers, we will use WebWorkers for Synthesizing the samples and a Flash player for playback
        ///
        /// - IE6-9   - Unsupported
        /// - IE10-11 - Flash is used for playback, Synthesizing is done in a WebWorker
        /// - Firefox - Web Audio API is used for playback, Synthesizing is done in a WebWorker
        /// - Chrome  - Web Audio API is used for playback, Synthesizing is done in a WebWorker
        /// - Safari  - Web Audio API is used for playback, Synthesizing is done in a WebWorker
        /// - Opera   - Web Audio API is used for playback, Synthesizing is done in a WebWorker
        /// </summary>
        public IAlphaSynth CreateWorkerPlayer()
        {
            var supportsWebAudio = Platform.Platform.SupportsWebAudio;
            var supportsWebWorkers = Platform.Platform.SupportsWebWorkers;
            var forceFlash = Platform.Platform.ForceFlash;
            var alphaSynthScriptFile = Environment.ScriptFile;

            AlphaSynthWebWorkerApi player = null;
            if (supportsWebAudio && !forceFlash)
            {
                Logger.Info("Player", "Will use webworkers for synthesizing and web audio api for playback");
                player = new AlphaSynthWebWorkerApi(new AlphaSynthWebAudioOutput(),
                    alphaSynthScriptFile,
                    _api.Settings.Core.LogLevel);
            }
            else if (supportsWebWorkers)
            {
                Logger.Info("Player", "Will use webworkers for synthesizing and flash for playback");
                player = new AlphaSynthWebWorkerApi(new AlphaSynthFlashOutput(alphaSynthScriptFile),
                    alphaSynthScriptFile,
                    _api.Settings.Core.LogLevel);
            }

            if (player == null)
            {
                Logger.Error("Player", "Player requires webworkers and web audio api or flash, browser unsupported");
            }
            else
            {
                player.Ready += () =>
                {
                    if (!string.IsNullOrEmpty(_api.Settings.Player.SoundFont))
                    {
                        ((AlphaTabApi)_api).LoadSoundFontFromUrl(_api.Settings.Player.SoundFont);
                    }
                };
            }

            return player;
        }

        public void BeginInvoke(Action action)
        {
            Browser.Window.RequestAnimationFrame(f => action());
        }

        public void HighlightElements(string groupId)
        {
            var element = ((HtmlElementContainer)_api.Container).Element;
            var elementsToHighlight = element.GetElementsByClassName(groupId);
            for (var i = 0; i < elementsToHighlight.Length; i++)
            {
                elementsToHighlight.Item(i).ClassList.Add("at-highlight");
            }
        }

        public void RemoveHighlights()
        {
            var element = ((HtmlElementContainer)_api.Container).Element;
            var elements = element.GetElementsByClassName("at-highlight");
            while (elements.Length > 0)
            {
                elements.Item(0).ClassList.Remove("at-highlight");
            }
        }

        public void DestroyCursors()
        {
            var element = ((HtmlElementContainer)_api.Container).Element;
            var cursorWrapper = element.QuerySelector(".at-cursors");
            element.RemoveChild(cursorWrapper);
        }

        public Cursors CreateCursors()
        {
            var element = ((HtmlElementContainer)_api.Container).Element;
            var cursorWrapper = Browser.Document.CreateElement("div");
            cursorWrapper.ClassList.Add("at-cursors");

            var selectionWrapper = Browser.Document.CreateElement("div");
            selectionWrapper.ClassList.Add("at-selection");

            var barCursor = Browser.Document.CreateElement("div");
            barCursor.ClassList.Add("at-cursor-bar");

            var beatCursor = Browser.Document.CreateElement("div");
            beatCursor.ClassList.Add("at-cursor-beat");

            // required css styles
            element.Style.Position = "relative";
            element.Style.TextAlign = "left";

            cursorWrapper.Style.Position = "absolute";
            cursorWrapper.Style.ZIndex = "1000";
            cursorWrapper.Style.Display = "inline";
            Script.Write("untyped __js__(\"{0}.pointerEvents = 'none'\", cursorWrapper.style);");

            selectionWrapper.Style.Position = "absolute";
            barCursor.Style.Position = "absolute";
            beatCursor.Style.Position = "absolute";
            beatCursor.Style.Transition = "all 0s linear";

            // add cursors to UI
            element.InsertBefore(cursorWrapper, element.FirstChild);
            cursorWrapper.AppendChild(selectionWrapper);
            cursorWrapper.AppendChild(barCursor);
            cursorWrapper.AppendChild(beatCursor);

            return new Cursors(
                new HtmlElementContainer(cursorWrapper),
                new HtmlElementContainer(barCursor),
                new HtmlElementContainer(beatCursor),
                new HtmlElementContainer(selectionWrapper)
            );
        }

        public Bounds GetOffset(IContainer scrollContainer, IContainer container)
        {
            var element = ((HtmlElementContainer)container).Element;
            var bounds = element.GetBoundingClientRect();
            float top = bounds.Top + element.OwnerDocument.DefaultView.PageYOffset;
            float left = bounds.Left + element.OwnerDocument.DefaultView.PageXOffset;

            if (scrollContainer != null)
            {
                var scrollElement = ((HtmlElementContainer)scrollContainer).Element;
                var nodeName = scrollElement.NodeName.ToLowerCase();
                if (nodeName != "html" && nodeName != "body")
                {
                    var scrollElementOffset = GetOffset(null, scrollContainer);
                    top = top + scrollElement.ScrollTop - scrollElementOffset.Y;
                    left = left + scrollElement.ScrollLeft - scrollElementOffset.X;
                }
            }

            return new Bounds
            {
                X = left,
                Y = top,
                W = bounds.Width,
                H = bounds.Height
            };
        }

        public IContainer GetScrollContainer()
        {
            var scrollElement = Platform.Platform.TypeOf(_api.Settings.Player.ScrollElement) == "string"
                ? Browser.Document.QuerySelector(_api.Settings.Player.ScrollElement)
                : _api.Settings.Player.ScrollElement.As<Element>();

            var nodeName = scrollElement.NodeName.ToLowerCase();
            if (nodeName == "html" || nodeName == "body")
            {
                // https://github.com/CoderLine/alphaTab/issues/205
                // https://github.com/CoderLine/alphaTab/issues/354
                // https://dev.opera.com/articles/fixing-the-scrolltop-bug/
                if (Platform.Platform.JsonExists(Browser.Document, "scrollingElement"))
                {
                    scrollElement = Script.Write<Element>("untyped __js__(\"document.scrollingElement\")");
                }
                else
                {
                    string userAgent = Browser.Navigator.UserAgent;
                    if (userAgent.IndexOf("WebKit") != -1)
                    {
                        scrollElement = Browser.Document.Body;
                    }
                    else
                    {
                        scrollElement = Browser.Document.DocumentElement;
                    }
                }
            }

            return new HtmlElementContainer(scrollElement);
        }

        public IContainer CreateSelectionElement()
        {
            var element = Browser.Document.CreateElement("div");
            element.Style.Position = "absolute";
            return new HtmlElementContainer(element);
        }

        public void ScrollToY(IContainer element, int scrollTargetY, int speed)
        {
            InternalScrollToY(((HtmlElementContainer)element).Element, scrollTargetY, speed);
        }

        public void ScrollToX(IContainer element, int scrollTargetY, int speed)
        {
            InternalScrollToX(((HtmlElementContainer)element).Element, scrollTargetY, speed);
        }

        private void InternalScrollToY(DOMElement element, int scrollTargetY, double speed)
        {
            var startY = element.ScrollTop;
            var diff = scrollTargetY - startY;
            HaxeFloat start = 0;

            Action<HaxeFloat> step = null;
            step = x =>
            {
                if (start == 0)
                {
                    start = x;
                }

                double time = x - start;
                var percent = Math.Min(time / speed, 1);
                element.ScrollTop = (int)(startY + diff * percent);

                if (time < speed)
                {
                    Browser.Window.RequestAnimationFrame(step);
                }
            };
            Browser.Window.RequestAnimationFrame(step);
        }

        private void InternalScrollToX(DOMElement element, int scrollTargetX, int speed)
        {
            var startX = element.ScrollLeft;
            var diff = scrollTargetX - startX;
            HaxeFloat start = 0;

            Action<HaxeFloat> step = null;
            step = t =>
            {
                if (start == 0)
                {
                    start = t;
                }

                double time = t - start;
                var percent = Math.Min(time / speed, 1);
                element.ScrollLeft = (int)(startX + diff * percent);

                if (time < speed)
                {
                    Browser.Window.RequestAnimationFrame(step);
                }
            };
            Browser.Window.RequestAnimationFrame(step);
        }
    }
}
