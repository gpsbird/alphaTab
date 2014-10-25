﻿/*
 * This file is part of alphaTab.
 * Copyright (c) 2014, Daniel Kuschny and Contributors, All rights reserved.
 * 
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3.0 of the License, or at your option any later version.
 * 
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 * 
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library.
 */
using System.Runtime.CompilerServices;
using AlphaTab.Collections;

namespace AlphaTab.Rendering.Staves
{
    /// <summary>
    /// This public class stores size information about a stave. 
    /// It is used by the layout engine to collect the sizes of score parts
    /// to align the parts across multiple staves.
    /// </summary>
    public class BarSizeInfo
    {
        public int FullWidth { get; set; }
        public FastDictionary<string, int> Sizes { get; set; }

        public FastDictionary<int, int> PreNoteSizes { get; set; }
        public FastDictionary<int, int> OnNoteSizes { get; set; }
        public FastDictionary<int, int> PostNoteSizes { get; set; }

        public BarSizeInfo()
        {
            Sizes = new FastDictionary<string, int>();
            PreNoteSizes = new FastDictionary<int, int>();
            OnNoteSizes = new FastDictionary<int, int>();
            PostNoteSizes = new FastDictionary<int, int>();
            FullWidth = 0;
        }

        public void SetSize(string key, int size)
        {
            Sizes[key] = size;
        }

        public int GetSize(string key)
        {
            if (Sizes.ContainsKey(key))
            {
                return Sizes[key];
            }
            return 0;
        }

        public int GetPreNoteSize(int beat)
        {
            if (PreNoteSizes.ContainsKey(beat))
            {
                return PreNoteSizes[beat];
            }
            return 0;
        }

        public int GetOnNoteSize(int beat)
        {
            if (OnNoteSizes.ContainsKey(beat))
            {
                return OnNoteSizes[beat];
            }
            return 0;
        }

        public int GetPostNoteSize(int beat)
        {
            if (PostNoteSizes.ContainsKey(beat))
            {
                return PostNoteSizes[beat];
            }
            return 0;
        }

        public void SetPreNoteSize(int beat, int size)
        {
            PreNoteSizes[beat] = size;
        }

        public void SetOnNoteSize(int beat, int size)
        {
            OnNoteSizes[beat] = size;
        }

        public void SetPostNoteSize(int beat, int size)
        {
            PostNoteSizes[beat] = size;
        }
    }
}
