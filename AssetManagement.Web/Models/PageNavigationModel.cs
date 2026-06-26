namespace AssetManagement.Web.Models;

public class PageNavigationModel
{
    public int PageIndex { get; init; }
    public int PageSize { get; init; }
    public int TotalPages { get; init; }
    public bool HasPreviousPage { get; init; }
    public bool HasNextPage { get; init; }
    public string Action { get; init; } = "Index";
    public Dictionary<string, string?> RouteValues { get; init; } = new();
}
