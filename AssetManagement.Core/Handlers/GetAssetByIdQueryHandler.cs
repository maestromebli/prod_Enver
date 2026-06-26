using AssetManagement.Core.Interfaces;
using AssetManagement.Core.Models;
using AssetManagement.Core.Queries;
using MediatR;

namespace AssetManagement.Core.Handlers;

public class GetAssetByIdQueryHandler : IRequestHandler<GetAssetByIdQuery, AssetSummary?>
{
    private readonly IAssetRepository _repository;

    public GetAssetByIdQueryHandler(IAssetRepository repository) => _repository = repository;

    public Task<AssetSummary?> Handle(GetAssetByIdQuery request, CancellationToken cancellationToken) =>
        _repository.GetAssetByIdAsync(request.AssetId, cancellationToken);
}
